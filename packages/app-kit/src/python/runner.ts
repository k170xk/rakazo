/**
 * The Python side of a calculation, loaded once into the interpreter. `_ocsc_run(request, runtime)`
 * takes the canonical request JSON ({code, inputs, packages}) and answers the result envelope as JSON.
 * It resets every source of run-to-run variation it can reach (seeds, numpy error state, the decimal
 * context, warning registries) and keeps to Python 3.9 so the same file checks results under CPython.
 */
export const PYTHON_RUNNER = String.raw`
import contextlib, dataclasses, datetime, decimal, fractions, hashlib, io, json, math, platform, random, sys, traceback, warnings
from importlib import metadata as _ocsc_metadata

_OCSC_MAX_TEXT = 100000
_OCSC_NUMPY_ERRORS = {"divide": "warn", "over": "warn", "under": "ignore", "invalid": "warn"}


def _ocsc_float(value):
    if math.isfinite(value):
        return value
    return {"$float": "nan" if value != value else ("inf" if value > 0 else "-inf")}


def _ocsc_revive(item):
    if len(item) == 1 and "$float" in item:
        return float(item["$float"])
    return item


def _ocsc_canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False)


def _ocsc_plain(value, at):
    if value is None or isinstance(value, (bool, str)):
        return value
    if isinstance(value, int):
        return value if -(2 ** 53) <= value <= 2 ** 53 else str(value)
    if isinstance(value, float):
        return _ocsc_float(value)
    if isinstance(value, complex):
        return {"re": _ocsc_float(value.real), "im": _ocsc_float(value.imag)}
    if isinstance(value, dict):
        return {str(key): _ocsc_plain(item, at + "." + str(key)) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_ocsc_plain(item, at + "[" + str(index) + "]") for index, item in enumerate(value)]
    if isinstance(value, (set, frozenset)):
        return sorted((_ocsc_plain(item, at + "[]") for item in value), key=_ocsc_canonical)
    if isinstance(value, (decimal.Decimal, fractions.Fraction)):
        return str(value)
    if isinstance(value, (datetime.date, datetime.time)):
        return value.isoformat()
    if dataclasses.is_dataclass(value) and not isinstance(value, type):
        return _ocsc_plain(dataclasses.asdict(value), at)
    family = type(value).__module__.split(".")[0]
    if family == "pandas":
        if hasattr(value, "columns") and hasattr(value, "to_dict"):
            split = value.to_dict(orient="split")
            return _ocsc_plain({"columns": split["columns"], "index": split["index"], "data": split["data"]}, at)
        if hasattr(value, "index") and hasattr(value, "tolist"):
            return _ocsc_plain({"name": value.name, "index": value.index.tolist(), "data": value.tolist()}, at)
        if str(value) == "NaT":
            return None
    if family == "sympy":
        import sympy
        out = {"text": str(value), "tex": sympy.latex(value)}
        try:
            out["value"] = _ocsc_float(float(value))
        except (TypeError, ValueError):
            pass
        return out
    if hasattr(value, "tolist") and family in ("numpy", "pandas"):
        return _ocsc_plain(value.tolist(), at)
    raise TypeError(at + " is a " + type(value).__name__ + ", which a calculation can't return; return numbers, text, lists or dicts.")


def _ocsc_reset():
    random.seed(0)
    numpy = sys.modules.get("numpy")
    if numpy is not None:
        numpy.random.seed(0)
        numpy.seterr(**_OCSC_NUMPY_ERRORS)
    decimal.setcontext(decimal.Context())


def _ocsc_where(error):
    lines = [frame.lineno for frame in traceback.extract_tb(error.__traceback__) if frame.filename == "calc.py"]
    if isinstance(error, SyntaxError) and error.filename == "calc.py":
        lines.append(error.lineno)
    head = traceback.format_exception_only(type(error), error)[-1].strip()
    return ("calc.py line " + str(lines[-1]) + ": " + head) if lines else head


def _ocsc_run(request_text, runtime):
    request = json.loads(request_text, object_hook=_ocsc_revive)
    code, inputs, packages = request["code"], request["inputs"], request["packages"]
    for name in packages:
        __import__(name)
    _ocsc_reset()
    stdout, stderr = io.StringIO(), io.StringIO()
    namespace = {"__name__": "__calc__"}
    error = None
    outputs = None
    with contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr), warnings.catch_warnings():
        warnings.simplefilter("always")
        try:
            exec(compile(code, "calc.py", "exec"), namespace)
            calc = namespace.get("calc")
            if not callable(calc):
                raise NameError("calc.py must define calc(inputs) and return its results.")
            outputs = _ocsc_plain(calc(inputs), "outputs")
        except Exception as caught:
            error = _ocsc_where(caught)
    versions = {
        "python": platform.python_version(),
        "runtime": runtime,
        "packages": {name: _ocsc_metadata.version(name) for name in sorted(packages)},
    }
    key = hashlib.sha256(_ocsc_canonical({
        "code": code,
        "inputs": _ocsc_plain(inputs, "inputs"),
        "versions": versions,
    }).encode("utf-8")).hexdigest()
    envelope = {
        "stdout": stdout.getvalue()[:_OCSC_MAX_TEXT],
        "stderr": stderr.getvalue()[:_OCSC_MAX_TEXT],
        "versions": versions,
        "key": key,
    }
    if error is not None:
        envelope["error"] = error
    else:
        envelope["outputs"] = outputs
        envelope["hash"] = hashlib.sha256(_ocsc_canonical({"key": key, "outputs": outputs}).encode("utf-8")).hexdigest()
    return json.dumps(envelope, ensure_ascii=False, allow_nan=False)
`;
