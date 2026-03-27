import re
from urllib.parse import urlparse


INSTAGRAM_HOSTS = {"instagram.com", "www.instagram.com"}
INSTAGRAM_PATH_RE = re.compile(r"^/(reel|p|tv)/[A-Za-z0-9._-]+/?$")


def is_valid_instagram_url(value: str) -> bool:
    try:
        parsed = urlparse(str(value).strip())
    except ValueError:
        return False

    return (
        parsed.scheme in {"http", "https"}
        and parsed.netloc.lower() in INSTAGRAM_HOSTS
        and bool(INSTAGRAM_PATH_RE.match(parsed.path or ""))
    )
