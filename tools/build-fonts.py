#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
按项目实际用字子集化字体：assets/fonts/*.woff2 + css/fonts.css

为什么不用 Google Fonts：
  1. 中文字体被切成 100+ 个 unicode-range 分片，标题页的字散落在 20 多个分片里，
     首屏要拉 ~1.2MB / 28 个字体文件；子集化后每个家族只有 1~2 个文件。
  2. fonts.googleapis.com 在国内不可靠，同源自托管国内外速度一致，且 file:// 双击可离线玩。

中文字体会再按 Latin / 汉字拆成两个文件（CSS 里用 unicode-range 区分）：
  只画数字的场景（标题页的主题预览小图轴文字）只拉十来 KB 的 Latin 分片，不会为了几个
  数字把整个汉字子集拖下来。

用法：
  python3 -m pip install fonttools brotli     # 仅构建时需要
  python3 tools/build-fonts.py

改了中文文案后重跑一次即可；扫描不到的字会回退到系统字体（不会出豆腐块），
但为了视觉一致，改完文案建议重跑。源字体缓存在 .cache/fonts/（已 gitignore）。
"""
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / '.cache' / 'fonts'
OUT = ROOT / 'assets' / 'fonts'
CSS_OUT = ROOT / 'css' / 'fonts.css'
UPSTREAM = 'https://raw.githubusercontent.com/google/fonts/main/ofl/'
VERSION = '174'          # 重新生成后改这个值，让浏览器丢掉旧字体缓存

# out 文件名 / CSS 家族名 / font-weight / 上游文件 / font-style / 是否拆分拉丁与汉字
FONTS = [
    ('noto-sans-sc',        'Noto Sans SC',        '100 900', 'notosanssc/NotoSansSC[wght].ttf',                      'normal', True),
    ('noto-serif-sc',       'Noto Serif SC',       '200 900', 'notoserifsc/NotoSerifSC[wght].ttf',                    'normal', True),
    ('ma-shan-zheng',       'Ma Shan Zheng',       '400',     'mashanzheng/MaShanZheng-Regular.ttf',                  'normal', True),
    ('zcool-xiaowei',       'ZCOOL XiaoWei',       '400',     'zcoolxiaowei/ZCOOLXiaoWei-Regular.ttf',                'normal', True),
    ('zcool-kuaile',        'ZCOOL KuaiLe',        '400',     'zcoolkuaile/ZCOOLKuaiLe-Regular.ttf',                  'normal', True),
    ('orbitron',            'Orbitron',            '400 900', 'orbitron/Orbitron[wght].ttf',                          'normal', False),
    ('fredoka',             'Fredoka',             '300 700', 'fredoka/Fredoka[wdth,wght].ttf',                       'normal', False),
    ('cormorant-garamond',  'Cormorant Garamond',  '300 700', 'cormorantgaramond/CormorantGaramond[wght].ttf',        'normal', False),
    ('cormorant-garamond-i','Cormorant Garamond',  '300 700', 'cormorantgaramond/CormorantGaramond-Italic[wght].ttf', 'italic', False),
    ('chakra-petch-400',    'Chakra Petch',        '400',     'chakrapetch/ChakraPetch-Regular.ttf',                  'normal', False),
    ('chakra-petch-600',    'Chakra Petch',        '600',     'chakrapetch/ChakraPetch-SemiBold.ttf',                 'normal', False),
    ('chakra-petch-700',    'Chakra Petch',        '700',     'chakrapetch/ChakraPetch-Bold.ttf',                     'normal', False),
    ('vt323',               'VT323',               '400',     'vt323/VT323-Regular.ttf',                              'normal', False),
    ('share-tech-mono',     'Share Tech Mono',     '400',     'sharetechmono/ShareTechMono-Regular.ttf',              'normal', False),
]

# unicode-range 分区：U+2E80 以下 + 兼容区算 Latin；汉字/假名/全角/扩展区算 CJK
LATIN_RANGE = 'U+0000-2E7F, U+FB00-FEFF, U+FFF0-FFFF'
CJK_RANGE = 'U+2E80-9FFF, U+F900-FAFF, U+FF00-FFEF, U+20000-2FA1F'

SCAN = ['index.html']
SCAN += [str(p.relative_to(ROOT)) for p in sorted(ROOT.glob('js/**/*.js'))]
SCAN += [str(p.relative_to(ROOT)) for p in sorted(ROOT.glob('css/**/*.css')) if p.name != 'fonts.css']

# 源码里扫不到、但运行时可能出现的字符：ASCII / 中文标点 / 全角符号 / 货币 / 常用符号
EXTRA = (
    ' !"#$%&\'()*+,-./0123456789:;<=>?@'
    'ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`'
    'abcdefghijklmnopqrstuvwxyz{|}~'
    '　、。，．·；：？！…—～｜「」『』（）《》〈〉【】〔〕％＋－×÷＝＃＆＊＠'
    '￥¥€£¢°±≤≥≠≈∞√∑∆▲▼◀▶●○■□◆◇★☆✓✕←→↑↓'
)


def collect_chars() -> str:
    chars = set(EXTRA)
    for rel in SCAN:
        text = (ROOT / rel).read_text(encoding='utf-8', errors='ignore')
        chars |= {c for c in text if c not in '\r\n\t'}
    return ''.join(sorted(chars))


def is_cjk(ch: str) -> bool:
    cp = ord(ch)
    return (0x2E80 <= cp <= 0x9FFF or 0xF900 <= cp <= 0xFAFF
            or 0xFF00 <= cp <= 0xFFEF or 0x20000 <= cp <= 0x2FA1F)


def fetch(rel_path: str) -> Path:
    CACHE.mkdir(parents=True, exist_ok=True)
    dst = CACHE / Path(rel_path).name
    if dst.exists() and dst.stat().st_size > 1024:
        return dst
    url = UPSTREAM + urllib.request.quote(rel_path)
    print(f'  下载 {url}')
    with urllib.request.urlopen(url) as r, open(dst, 'wb') as f:
        f.write(r.read())
    return dst


def subset(subset_mod, src: Path, chars: str, dst: Path) -> None:
    txt = CACHE / f'chars-{dst.stem}.txt'
    txt.write_text(chars, encoding='utf-8')
    subset_mod.main([
        str(src), f'--text-file={txt}', '--flavor=woff2',
        '--layout-features=kern,liga,calt,clig,ccmp,locl,mark,mkmk,vert',
        f'--output-file={dst}',
    ])


def main() -> int:
    try:
        from fontTools import subset as subset_mod
    except ImportError:
        print('缺 fonttools，先装：python3 -m pip install fonttools brotli', file=sys.stderr)
        return 1

    text = collect_chars()
    latin = ''.join(c for c in text if not is_cjk(c))
    cjk = ''.join(c for c in text if is_cjk(c))
    CACHE.mkdir(parents=True, exist_ok=True)
    print(f'扫描到 {len(text)} 个字符（汉字 {len(cjk)}，Latin/符号 {len(latin)}）')

    OUT.mkdir(parents=True, exist_ok=True)
    total = 0
    count = 0
    generated = set()
    css = [
        '/* 自动生成：python3 tools/build-fonts.py —— 不要手改 */',
        '/* 缺字回退系统字体，不会出豆腐块；改文案后重跑脚本，并把 VERSION 加一 */',
        '',
    ]

    def face(family, style, weight, file, urange=None):
        rule = ['@font-face {', f'  font-family: "{family}";', f'  font-style: {style};',
                f'  font-weight: {weight};', '  font-display: swap;']
        if urange:
            rule.append(f'  unicode-range: {urange};')
        rule.append(f'  src: url("../assets/fonts/{file}?v={VERSION}") format("woff2");')
        rule.append('}')
        css.append('\n'.join(rule))

    for out, family, weight, upstream, style, split in FONTS:
        src = fetch(upstream)
        if split:
            groups = [('latin', latin, LATIN_RANGE), ('cjk', cjk, CJK_RANGE)]
        else:
            groups = [('', text, None)]
        for suffix, chars, urange in groups:
            name = f'{out}-{suffix}' if suffix else out
            dst = OUT / f'{name}.woff2'
            subset(subset_mod, src, chars, dst)
            generated.add(dst.name)
            size = dst.stat().st_size
            total += size
            count += 1
            print(f'  {name:26s} {size / 1024:6.1f} KB')
            face(family, style, weight, f'{name}.woff2', urange)

    # 清掉上一次生成、这次不再需要的子集（改名/拆分会留下孤儿文件）
    for old in sorted(OUT.glob('*.woff2')):
        if old.name not in generated:
            old.unlink()
            print(f'  删除过期文件 {old.name}')

    css.append('')
    CSS_OUT.write_text('\n'.join(css), encoding='utf-8')
    print(f'\n共 {count} 个字体文件 / {total / 1024:.0f} KB → assets/fonts/')
    print(f'@font-face 写进 {CSS_OUT.relative_to(ROOT)}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
