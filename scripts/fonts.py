"""문서에 쓰인 글자만 남긴 Pretendard 서브셋을 woff(base64) @font-face CSS로 만든다.

사용: python fonts.py <chars.txt> <out.css>
학교 PC에 폰트가 없거나 인터넷이 막혀도 모든 산출물이 같은 글꼴로 보이게 하려는 목적.
"""
import base64, io, os, sys
from fontTools import subset
from fontTools.ttLib import TTFont

HERE = os.path.dirname(os.path.abspath(__file__))
FONT_DIR = os.path.join(HERE, "..", "assets", "fonts")
WEIGHTS = [(400, "Regular"), (500, "Medium"), (600, "SemiBold"), (700, "Bold"), (800, "ExtraBold")]
# 항상 포함: ASCII, 자주 쓰는 기호, 원문자(선택지), 화살표
ALWAYS = "".join(chr(c) for c in range(0x20, 0x7F)) + "·…‘’“”–—→←↑↓↔①②③④⑤⑥⑦⑧⑨⑩○×□■▶※★☆℃°%‰±≤≥≠≈÷√∞πΔ㎝㎜㎞㎏㎖ℓ²³ⅠⅡⅢⅣⅤ"


def subset_font(path, text):
    opts = subset.Options()
    opts.flavor = "woff"
    opts.layout_features = ["*"]
    opts.name_IDs = ["*"]
    opts.notdef_outline = True
    font = TTFont(path)
    sub = subset.Subsetter(opts)
    sub.populate(text=text)
    sub.subset(font)
    buf = io.BytesIO()
    font.flavor = "woff"
    font.save(buf)
    return buf.getvalue()


def main():
    chars_path, out_css = sys.argv[1], sys.argv[2]
    text = open(chars_path, encoding="utf-8").read() + ALWAYS
    text = "".join(sorted(set(text)))
    rules, total = [], 0
    for weight, name in WEIGHTS:
        data = subset_font(os.path.join(FONT_DIR, f"Pretendard-{name}.ttf"), text)
        total += len(data)
        b64 = base64.b64encode(data).decode("ascii")
        rules.append(
            "@font-face{font-family:'CF Pretendard';font-style:normal;"
            f"font-weight:{weight};font-display:block;"
            f"src:url(data:font/woff;base64,{b64}) format('woff');}}"
        )
    with open(out_css, "w", encoding="utf-8") as f:
        f.write("\n".join(rules) + "\n")
    print(f"fonts: {len(text)} glyphs, {total // 1024} KB (5 weights)")


if __name__ == "__main__":
    main()
