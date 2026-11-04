# -*- coding: utf-8 -*-
"""把生成的现代题图统一成：1080x472、灰调、右下角无水印、体积可控。
用法：python _img.py <源图> <目标名>   （目标名不带扩展名，输出 assets/mo/<名>.jpg）
"""
import sys, os
from PIL import Image, ImageEnhance, ImageOps

W, H = 1080, 472
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'assets', 'mo')


def cover(im, w, h):
    sw, sh = im.size
    s = max(w / sw, h / sh)
    im = im.resize((max(w, int(sw * s + .5)), max(h, int(sh * s + .5))), Image.LANCZOS)
    x = (im.size[0] - w) // 2
    # 竖直方向略偏上：这类图上方多是墙/天，下面多是地，切地比切天安全
    y = int((im.size[1] - h) * 0.42)
    return im.crop((x, y, x + w, y + h))


def main(src, name):
    im = Image.open(src).convert('RGB')
    im = cover(im, W, H)
    # 去色：只留一点暖，靠页面上的 sepia(.06) 统一
    g = ImageOps.grayscale(im)
    g = ImageEnhance.Contrast(g).enhance(1.04)
    g = ImageEnhance.Brightness(g).enhance(1.02)
    g = g.convert('RGB')
    os.makedirs(OUT, exist_ok=True)
    dst = os.path.join(OUT, name + '.jpg')
    g.save(dst, 'JPEG', quality=84, optimize=True, progressive=True)
    print('%s  %dx%d  %.0f KB' % (dst, W, H, os.path.getsize(dst) / 1024))


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
