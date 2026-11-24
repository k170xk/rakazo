import importlib.machinery
import importlib.util
import os
import sqlite3
import tempfile
import time
import unittest


def load_browser_sync():
    script_path = os.path.join(os.path.dirname(__file__), "rakazo-browser-sync")
    loader = importlib.machinery.SourceFileLoader("rakazo_browser_sync", script_path)
    spec = importlib.util.spec_from_loader("rakazo_browser_sync", loader)
    mod = importlib.util.module_from_spec(spec)
    loader.exec_module(mod)
    return mod


def create_cookies_db(path: str, rows: list[tuple]) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    con = sqlite3.connect(path)
    con.execute(
        """
        CREATE TABLE cookies (
            creation_utc INTEGER NOT NULL,
            host_key TEXT NOT NULL,
            top_frame_site_key TEXT NOT NULL DEFAULT '',
            has_cross_site_ancestor INTEGER NOT NULL DEFAULT 0,
            name TEXT NOT NULL,
            value TEXT NOT NULL DEFAULT '',
            encrypted_value BLOB NOT NULL DEFAULT X'',
            path TEXT NOT NULL DEFAULT '/',
            expires_utc INTEGER NOT NULL DEFAULT 0,
            last_access_utc INTEGER NOT NULL DEFAULT 0,
            last_update_utc INTEGER NOT NULL DEFAULT 0,
            source_scheme INTEGER NOT NULL DEFAULT 2,
            source_port INTEGER NOT NULL DEFAULT 443
        )
        """
    )
    con.executemany(
        """
        INSERT INTO cookies (
            creation_utc, host_key, name, encrypted_value, expires_utc, last_access_utc, last_update_utc
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
        """,
        rows,
    )
    con.commit()
    con.close()


def read_cookies(path: str) -> dict[tuple[str, str], tuple[bytes, int]]:
    con = sqlite3.connect(path)
    out = {
        (h, n): (v, upd)
        for h, n, v, upd in con.execute(
            "SELECT host_key, name, encrypted_value, last_update_utc FROM cookies"
        ).fetchall()
    }
    con.close()
    return out


class BrowserSyncTests(unittest.TestCase):
    def setUp(self) -> None:
        self.mod = load_browser_sync()
        self.tmp = tempfile.TemporaryDirectory()
        self.orig_home = os.environ.get("HOME")
        os.environ["HOME"] = self.tmp.name
        self.root = os.path.join(self.tmp.name, ".browser-profiles")
        os.makedirs(self.root, exist_ok=True)
        self.future_utc = self.mod.now_chrome_utc() + 3600 * 1_000_000
        self.past_utc = self.mod.now_chrome_utc() - 3600 * 1_000_000

    def tearDown(self) -> None:
        if self.orig_home is None:
            os.environ.pop("HOME", None)
        else:
            os.environ["HOME"] = self.orig_home
        self.tmp.cleanup()

    def test_google_cookies_never_cloned_across_profiles_while_other_sites_sync(self) -> None:
        bot_a = os.path.join(self.root, "chromium-bot-aaaa")
        bot_b = os.path.join(self.root, "chromium-bot-bbbb")
        now = self.mod.now_chrome_utc()

        create_cookies_db(
            os.path.join(bot_a, "Default", "Cookies"),
            [
                (now - 10, ".google.com", "SID", b"v10google-sid", self.future_utc, now, now),
                (now - 10, ".google.com", "SIDCC", b"v10google-sidcc", self.future_utc, now, now),
                (now - 10, ".google.co.uk", "SID", b"v10uk-sid", self.future_utc, now, now),
                (now - 10, "accounts.google.com", "LSID", b"v10lsid", self.future_utc, now, now),
                (now - 10, "ads.google.com", "OSID", b"v10osid", self.future_utc, now, now),
                (now - 10, ".youtube.com", "LOGIN_INFO", b"v10yt", self.future_utc, now, now),
                (now - 10, ".godaddy.com", "auth_jomax", b"v10gd", self.future_utc, now, now),
                (now - 10, "outlook.cloud.microsoft", "ESTSAUTH", b"v10ms", self.future_utc, now, now),
            ],
        )

        # Save bot A into user-session and seed brand-new bot B.
        self.mod.cmd_save(bot_a)
        self.mod.cmd_seed(bot_b)

        # Bot A still keeps its own Google cookies untouched.
        a_cookies = read_cookies(os.path.join(bot_a, "Default", "Cookies"))
        self.assertIn((".google.com", "SIDCC"), a_cookies)
        self.assertIn(("ads.google.com", "OSID"), a_cookies)

        # Neither user-session nor bot B received cloned Google/YouTube cookies.
        for label, db_path in (
            ("user-session", os.path.join(self.root, "user-session", "Default", "Cookies")),
            ("bot-b", os.path.join(bot_b, "Default", "Cookies")),
        ):
            cookies = read_cookies(db_path)
            self.assertNotIn((".google.com", "SID"), cookies, label)
            self.assertNotIn((".google.com", "SIDCC"), cookies, label)
            self.assertNotIn((".google.co.uk", "SID"), cookies, label)
            self.assertNotIn(("accounts.google.com", "LSID"), cookies, label)
            self.assertNotIn(("ads.google.com", "OSID"), cookies, label)
            self.assertNotIn((".youtube.com", "LOGIN_INFO"), cookies, label)
            # Non-Google logins still sync cleanly.
            self.assertEqual(cookies[(".godaddy.com", "auth_jomax")][0], b"v10gd", label)
            self.assertEqual(cookies[("outlook.cloud.microsoft", "ESTSAUTH")][0], b"v10ms", label)

    def test_stale_cookie_with_newer_last_access_does_not_overwrite_fresh_update(self) -> None:
        bot_a = os.path.join(self.root, "chromium-bot-aaaa")
        bot_b = os.path.join(self.root, "chromium-bot-bbbb")
        now = self.mod.now_chrome_utc()

        # Bot A has a freshly updated cookie (last_update_utc = now).
        create_cookies_db(
            os.path.join(bot_a, "Default", "Cookies"),
            [(now - 100, ".example.com", "session", b"fresh", self.future_utc, now, now)],
        )
        # Bot B has an OLD cookie (last_update_utc = now - 500) that was READ more recently
        # (last_access_utc = now + 1000) plus an expired cookie.
        create_cookies_db(
            os.path.join(bot_b, "Default", "Cookies"),
            [
                (now - 600, ".example.com", "session", b"stale", self.future_utc, now + 1000, now - 500),
                (now - 600, ".example.com", "dead", b"expired", self.past_utc, now + 1000, now + 1000),
            ],
        )

        self.mod.cmd_seed(bot_a)
        a_cookies = read_cookies(os.path.join(bot_a, "Default", "Cookies"))
        self.assertEqual(a_cookies[(".example.com", "session")][0], b"fresh")
        self.assertNotIn((".example.com", "dead"), a_cookies)

    def test_profile_web_storage_restores_own_archive_and_never_clobbers_live_storage(self) -> None:
        bot_a = os.path.join(self.root, "chromium-bot-aaaa")
        bot_b = os.path.join(self.root, "chromium-bot-bbbb")
        ldb_a = os.path.join(bot_a, "Default", "Local Storage", "leveldb")
        ldb_b = os.path.join(bot_b, "Default", "Local Storage", "leveldb")
        os.makedirs(ldb_a, exist_ok=True)
        os.makedirs(ldb_b, exist_ok=True)

        with open(os.path.join(ldb_a, "000003.log"), "wb") as f:
            f.write(b"bot-a-token")
        self.mod.cmd_save(bot_a)

        # Bot B writes newer storage afterwards.
        time.sleep(0.02)
        with open(os.path.join(ldb_b, "000003.log"), "wb") as f:
            f.write(b"bot-b-token")
        self.mod.cmd_save(bot_b)

        # Seeding Bot A while its storage is present must NOT replace it with Bot B's.
        self.mod.cmd_seed(bot_a)
        with open(os.path.join(ldb_a, "000003.log"), "rb") as f:
            self.assertEqual(f.read(), b"bot-a-token")

        # Simulate sleep/wake dropping *.log from Bot A: seed must restore Bot A's OWN archive.
        os.unlink(os.path.join(ldb_a, "000003.log"))
        self.mod.cmd_seed(bot_a)
        with open(os.path.join(ldb_a, "000003.log"), "rb") as f:
            self.assertEqual(f.read(), b"bot-a-token")


if __name__ == "__main__":
    unittest.main()
