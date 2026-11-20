/**
 * The Lingui macro compiles away in the app build; tests run the source, so `t` just renders the
 * English template.
 */
export function t(strings: TemplateStringsArray, ...values: unknown[]): string {
  return String.raw(strings, ...values);
}

export function plural(count: number, forms: { one?: string; other: string; [form: string]: string | undefined }): string {
  const form = forms[`=${count}`] ?? (count === 1 ? (forms.one ?? forms.other) : forms.other);
  return form.replace(/#/g, String(count));
}
