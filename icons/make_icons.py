from PIL import Image, ImageDraw
import os

OUT = "/workspace/creator-toolkit/icons"
os.makedirs(OUT, exist_ok=True)

SS = 4  # supersample

def gradient(size):
    small = Image.new("RGB", (16, 16))
    px = small.load()
    c1 = (124, 139, 255)   # violet
    c2 = (56, 217, 201)    # teal
    for y in range(16):
        for x in range(16):
            t = (x + y) / 30.0
            px[x, y] = tuple(int(c1[i] + (c2[i] - c1[i]) * t) for i in range(3))
    return small.resize((size, size), Image.BICUBIC)

def make(size, maskable=False):
    W = size * SS
    img = Image.new("RGBA", (W, W), (0, 0, 0, 0))
    bg = gradient(W).convert("RGBA")

    if maskable:
        # full-bleed background for maskable
        img.paste(bg, (0, 0))
        content_scale = 0.62
    else:
        # rounded square
        radius = int(W * 0.225)
        mask = Image.new("L", (W, W), 0)
        d = ImageDraw.Draw(mask)
        d.rounded_rectangle([0, 0, W - 1, W - 1], radius=radius, fill=255)
        img.paste(bg, (0, 0), mask)
        content_scale = 1.0

    # soft vertical light falloff (no hard edges)
    hi = Image.new("RGBA", (4, 128), (0, 0, 0, 0))
    hp = hi.load()
    for y in range(128):
        a = int(26 * (1 - y / 127.0))
        for x in range(4):
            hp[x, y] = (255, 255, 255, a)
    hi = hi.resize((W, W), Image.BICUBIC)
    if not maskable:
        hi.putalpha(Image.composite(hi.split()[3], Image.new("L", (W, W), 0), mask))
    img = Image.alpha_composite(img, hi)

    # 2x2 rounded tiles (the "toolkit" mark)
    draw = ImageDraw.Draw(img)
    grid = W * 0.52 * content_scale
    gap = grid * 0.13
    tile = (grid - gap) / 2
    x0 = (W - grid) / 2
    y0 = (W - grid) / 2
    alphas = [[255, 150], [130, 235]]
    for r in range(2):
        for c in range(2):
            x = x0 + c * (tile + gap)
            y = y0 + r * (tile + gap)
            draw.rounded_rectangle([x, y, x + tile, y + tile], radius=tile * 0.28,
                                   fill=(255, 255, 255, alphas[r][c]))
    return img.resize((size, size), Image.LANCZOS)

for s in (192, 512, 180, 32):
    make(s).save(os.path.join(OUT, f"icon-{s}.png"))
make(512, maskable=True).save(os.path.join(OUT, "icon-maskable-512.png"))
print("done", sorted(os.listdir(OUT)))
