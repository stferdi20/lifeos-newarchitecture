import io
from pathlib import Path
import unittest

from PIL import Image, ImageDraw

from app.services.instagram_downloader import (
    compress_thumbnail_bytes,
    make_thumbnail_payload,
    resolve_drive_upload_mime_type,
)


class ThumbnailCompressionTests(unittest.TestCase):
    def make_source_bytes(self) -> bytes:
        image = Image.new('RGB', (1600, 900), color='white')
        draw = ImageDraw.Draw(image)

        palette = [
            (239, 68, 68),
            (249, 115, 22),
            (234, 179, 8),
            (34, 197, 94),
            (14, 165, 233),
        ]
        stripe_height = image.height // len(palette)
        for index, color in enumerate(palette):
            top = index * stripe_height
            bottom = image.height if index == len(palette) - 1 else (index + 1) * stripe_height
            draw.rectangle((0, top, image.width, bottom), fill=color)

        draw.rectangle((120, 120, 1480, 780), outline=(17, 24, 39), width=20)
        draw.ellipse((520, 220, 1080, 780), outline=(255, 255, 255), width=18)

        buffer = io.BytesIO()
        image.save(buffer, format='PNG')
        return buffer.getvalue()

    def test_compress_thumbnail_bytes_targets_small_webp_output(self):
        compressed = compress_thumbnail_bytes(self.make_source_bytes())

        self.assertTrue(compressed)
        self.assertLessEqual(len(compressed), 50 * 1024)

        with Image.open(io.BytesIO(compressed)) as image:
            self.assertEqual(image.format, 'WEBP')
            self.assertLessEqual(max(image.size), 640)

    def test_make_thumbnail_payload_returns_webp_fields(self):
        payload = make_thumbnail_payload(self.make_source_bytes(), 'preview image.jpg')

        self.assertEqual(payload['filename'], 'preview_image.webp')
        self.assertEqual(payload['content_type'], 'image/webp')
        self.assertGreater(len(payload['data_base64']), 0)

    def test_drive_upload_mime_type_uses_upload_name_for_temp_files(self):
        self.assertEqual(
            resolve_drive_upload_mime_type(Path('/tmp/compressed-output'), 'instagram_reel.mp4'),
            'video/mp4',
        )
        self.assertEqual(
            resolve_drive_upload_mime_type(Path('/tmp/compressed-output.bin'), 'preview.webp'),
            'image/webp',
        )


if __name__ == '__main__':
    unittest.main()
