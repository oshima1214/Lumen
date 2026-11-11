"""合成フィクスチャを生成する（npm run fixtures）。Pillow を使う開発用スクリプト。
生成物は小さいのでコミットする（テスト実行時に Pillow は不要）。"""
from pathlib import Path
from PIL import Image

out = Path(__file__).parent
# sRGB 中間灰 128（4:4:4、最高画質）
Image.new('RGB', (64, 64), (128, 128, 128)).save(out / 'gray128.jpg', quality=100, subsampling=0)
# 横グラデーション PNG
g = Image.new('RGB', (256, 16))
g.putdata([(x, x, x) for y in range(16) for x in range(256)])
g.save(out / 'gradient.png')
# 8 色チャート
cols = [(255,0,0),(255,128,0),(255,255,0),(0,255,0),(0,255,255),(0,0,255),(128,0,255),(255,0,255)]
c = Image.new('RGB', (64, 8))
c.putdata([cols[x // 8] for y in range(8) for x in range(64)])
c.save(out / 'colorchart.png')
# EXIF orientation 6、左半分赤・右半分青（保存時の画素配置で）
o = Image.new('RGB', (40, 20))
o.putdata([(255, 0, 0) if x < 20 else (0, 0, 255) for y in range(20) for x in range(40)])
exif = Image.Exif(); exif[0x0112] = 6
o.save(out / 'orient6.jpg', quality=95, subsampling=0, exif=exif)
# 9000x1000 パノラマ（上限超え）
p = Image.linear_gradient('L').resize((9000, 1000)).convert('RGB')
p.save(out / 'pano9000.jpg', quality=85)
print('ok')
# HEIC（pillow-heif がある場合のみ）: libheif 経路の検証用
try:
    import pillow_heif
    pillow_heif.register_heif_opener()
    Image.new('RGB', (64, 48), (128, 128, 128)).save(out / 'gray128.heic', quality=95)
except ImportError:
    print('pillow-heif が無いので gray128.heic はスキップ')
# Display P3 タグ付きの純赤 JPEG（色空間の扱いの検証用。ICC は src/export/icc/DisplayP3.icc、CC0）
p3 = (Path(__file__).parent.parent.parent / 'src/export/icc/DisplayP3.icc').read_bytes()
Image.new('RGB', (16, 16), (255, 0, 0)).save(out / 'red-p3.jpg', quality=100, subsampling=0, icc_profile=p3)
Image.new('RGB', (16, 16), (255, 0, 0)).save(out / 'red-srgb.jpg', quality=100, subsampling=0)
