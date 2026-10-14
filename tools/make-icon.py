"""Draws the app icon (build/icon.png, 512x512) with nothing but the standard library.

A dark rounded square with three session rows, each with its state dot: working, waiting, done.
usage: python tools/make-icon.py
"""
import os
import struct
import zlib

SIZE = 512
SCALE = 3  # Supersampling for smooth edges.
N = SIZE * SCALE

BG = (22, 24, 29)
ROW = (47, 53, 66)
DOTS = [(91, 157, 255), (227, 160, 8), (63, 185, 80)]


def rounded(x, y, x0, y0, x1, y1, r):
    if x < x0 or x >= x1 or y < y0 or y >= y1:
        return False
    cx = min(max(x, x0 + r), x1 - r)
    cy = min(max(y, y0 + r), y1 - r)
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r


def pixel(x, y):
    s = N / 512
    if not rounded(x, y, 16 * s, 16 * s, 496 * s, 496 * s, 96 * s):
        return (0, 0, 0, 0)
    for i, dot in enumerate(DOTS):
        top = (124 + i * 96) * s
        if (x - 140 * s) ** 2 + (y - (top + 36 * s)) ** 2 <= (30 * s) ** 2:
            return (*dot, 255)
        if rounded(x, y, 200 * s, top + 12 * s, 400 * s, top + 60 * s, 24 * s):
            return (*ROW, 255)
    return (*BG, 255)


def main():
    rows = []
    for y in range(SIZE):
        row = bytearray([0])
        for x in range(SIZE):
            acc = [0, 0, 0, 0]
            for dy in range(SCALE):
                for dx in range(SCALE):
                    r, g, b, a = pixel(x * SCALE + dx + 0.5, y * SCALE + dy + 0.5)
                    acc[0] += r * a
                    acc[1] += g * a
                    acc[2] += b * a
                    acc[3] += a
            if acc[3]:
                row += bytes((acc[0] // acc[3], acc[1] // acc[3], acc[2] // acc[3], acc[3] // (SCALE * SCALE)))
            else:
                row += bytes(4)
        rows.append(bytes(row))

    def chunk(kind, data):
        body = kind + data
        return struct.pack('>I', len(data)) + body + struct.pack('>I', zlib.crc32(body) & 0xFFFFFFFF)

    png = (
        b'\x89PNG\r\n\x1a\n'
        + chunk(b'IHDR', struct.pack('>IIBBBBB', SIZE, SIZE, 8, 6, 0, 0, 0))
        + chunk(b'IDAT', zlib.compress(b''.join(rows), 9))
        + chunk(b'IEND', b'')
    )
    out = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'build', 'icon.png')
    os.makedirs(os.path.dirname(out), exist_ok=True)
    with open(out, 'wb') as f:
        f.write(png)
    print('wrote', os.path.normpath(out), len(png), 'bytes')


if __name__ == '__main__':
    main()
