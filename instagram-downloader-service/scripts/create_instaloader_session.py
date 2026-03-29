import getpass
import os
from pathlib import Path

import instaloader


def prompt(message: str, default: str = "") -> str:
    suffix = f" [{default}]" if default else ""
    value = input(f"{message}{suffix}: ").strip()
    return value or default


def main() -> int:
    default_username = os.getenv("INSTALOADER_USERNAME", "").strip()
    default_session_file = os.getenv("INSTALOADER_SESSION_FILE", "").strip() or "./instaloader.session"

    username = prompt("Instagram username", default_username)
    if not username:
        print("Instagram username is required.")
        return 1

    session_path = Path(prompt("Session file path", default_session_file)).expanduser().resolve()
    session_path.parent.mkdir(parents=True, exist_ok=True)

    password = getpass.getpass("Instagram password: ").strip()
    if not password:
        print("Instagram password is required.")
        return 1

    loader = instaloader.Instaloader(
        sleep=True,
        quiet=False,
        download_comments=False,
        save_metadata=False,
        compress_json=False,
        download_video_thumbnails=False,
        max_connection_attempts=1,
    )

    try:
        loader.login(username, password)
    except instaloader.exceptions.TwoFactorAuthRequiredException:
        code = prompt("Instagram 2FA code")
        if not code:
            print("Instagram 2FA code is required.")
            return 1
        loader.two_factor_login(code)

    authenticated_user = loader.test_login()
    if not authenticated_user:
        print("Instagram login succeeded, but the session could not be verified.")
        return 1

    loader.save_session_to_file(str(session_path))
    print(f"Saved Instaloader session for @{authenticated_user} to {session_path}")
    print("Set these environment variables for the worker:")
    print(f"INSTALOADER_USERNAME={authenticated_user}")
    print(f"INSTALOADER_SESSION_FILE={session_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
