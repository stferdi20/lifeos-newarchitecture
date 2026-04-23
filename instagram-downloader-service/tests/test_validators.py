import unittest

from app.utils.validators import is_valid_instagram_url


class InstagramValidatorTests(unittest.TestCase):
    def test_instagram_validator_accepts_canonical_post_urls(self):
        self.assertTrue(is_valid_instagram_url("https://www.instagram.com/reel/ABC123/"))
        self.assertTrue(is_valid_instagram_url("https://www.instagram.com/p/ABC123/"))
        self.assertTrue(is_valid_instagram_url("https://www.instagram.com/tv/ABC123/"))

    def test_instagram_validator_accepts_share_sheet_urls(self):
        self.assertTrue(is_valid_instagram_url("https://www.instagram.com/share/reel/ABC123/"))
        self.assertTrue(is_valid_instagram_url("https://www.instagram.com/share/p/ABC123/"))

    def test_instagram_validator_rejects_unsupported_paths(self):
        self.assertFalse(is_valid_instagram_url("https://www.instagram.com/stories/example/123/"))
        self.assertFalse(is_valid_instagram_url("https://example.com/reel/ABC123/"))


if __name__ == '__main__':
    unittest.main()
