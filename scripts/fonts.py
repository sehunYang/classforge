"""문서에 쓰인 글자만 남긴 Pretendard 서브셋을 woff(base64) @font-face CSS로 만든다.
`meta.font:"kopub"`이면 OS에 설치된 KoPubWorld Dotum도 local()로 찾아 앞에 얹는다(§ KoPub 아래).

사용: python fonts.py <chars.txt> <out.css> [pretendard|kopub]
학교 PC에 폰트가 없거나 인터넷이 막혀도 Pretendard만은 모든 산출물에서 같은 글꼴로 보이게 하려는 목적.

KoPub — 등록 후 무료지만 "가공(서브셋 포함)·프로그램/웹서비스에 넣어 배포"는 별도 승인이 필요하고
재배포도 금지된다. 그래서 KoPub 파일은 절대 읽어서 서브셋·base64 임베딩하지 않는다. 이미 그 PC에
설치돼 있는 폰트를 `local()`로 "가리키기"만 한다 — 파일을 이 스킬 안으로 복사하지 않고, 커밋도 하지
않는다. 미설치 PC에서는 그냥 안 걸리고(local() 매치 실패) CSS의 Pretendard로 자연히 대체된다.
"""
import base64, glob, io, json, os, sys
from fontTools import subset
from fontTools.ttLib import TTFont

HERE = os.path.dirname(os.path.abspath(__file__))
FONT_DIR = os.path.join(HERE, "..", "assets", "fonts")
WEIGHTS = [(400, "Regular"), (500, "Medium"), (600, "SemiBold"), (700, "Bold"), (800, "ExtraBold")]
# 항상 포함: ASCII, 자주 쓰는 기호, 원문자(선택지), 화살표
ALWAYS = "".join(chr(c) for c in range(0x20, 0x7F)) + "·…‘’“”–—→←↑↓↔①②③④⑤⑥⑦⑧⑨⑩○×□■▶※★☆℃°%‰±≤≥≠≈÷√∞πΔ㎝㎜㎞㎏㎖ℓ²³ⅠⅡⅢⅣⅤ"
KOPUB_WEIGHTS = {"Light": 300, "Medium": 500, "Bold": 700}  # Dotum만(Batang 제외)


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


def pretendard_rules(text):
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
    return rules, total


def _os_font_dirs():
    """Windows/macOS/Linux의 사용자·시스템 글꼴 폴더. classforge를 쓰는 교사 PC가 어느 OS든 찾도록
    셋 다 나열한다(현재 OS와 무관한 경로는 그냥 존재하지 않아 건너뛴다)."""
    home = os.path.expanduser("~")
    local = os.environ.get("LOCALAPPDATA", os.path.join(home, "AppData", "Local"))
    return [
        os.path.join(local, "Microsoft", "Windows", "Fonts"),  # Windows(사용자별 설치)
        "C:/Windows/Fonts",                                     # Windows(시스템)
        os.path.join(home, "Library", "Fonts"),                 # macOS(사용자)
        "/Library/Fonts",                                       # macOS(시스템)
        os.path.join(home, ".local", "share", "fonts"),         # Linux(사용자)
        "/usr/share/fonts",                                     # Linux(시스템)
    ]


def find_kopub_dotum():
    """설치된 KoPubWorld Dotum Light/Medium/Bold를 찾는다. {300:path, 500:path, 700:path} (일부만 찾으면 그만큼만)."""
    found = {}
    for d in _os_font_dirs():
        if not os.path.isdir(d):
            continue
        for root, _dirs, files in os.walk(d):
            for fn in files:
                low = fn.lower()
                if not low.endswith((".ttf", ".otf")) or "kopub" not in low or "dotum" not in low:
                    continue
                for label, weight in KOPUB_WEIGHTS.items():
                    if weight not in found and label.lower() in low:
                        found[weight] = os.path.join(root, fn)
    return found


def _name(font, nid):
    rec = font["name"].getName(nid, 3, 1, 0x409) or font["name"].getName(nid, 1, 0, 0)
    return rec.toUnicode() if rec else None


def kopub_face_rule(weight, path):
    """설치된 파일을 열어 정확한 전체 이름(nameID 4)·PostScript 이름(nameID 6)을 읽어 local()로만 참조한다.
    파일 바이트는 CSS에 들어가지 않는다 — 이름 문자열만 읽는다."""
    font = TTFont(path)
    full, ps = _name(font, 4), _name(font, 6)
    srcs = [f"local('{n}')" for n in (full, ps) if n]
    if not srcs:
        return None
    return (
        "@font-face{font-family:'CF KoPub';font-style:normal;"
        f"font-weight:{weight};font-display:swap;src:{','.join(srcs)};}}"
    )


def kopub_rules():
    """3획(300/500/700) 모두 설치돼 있어야 쓴다(하나라도 없으면 두께가 섞여 더 어색하다) — 아니면 'not-installed'."""
    found = find_kopub_dotum()
    if not {300, 500, 700}.issubset(found):
        return None, "not-installed"
    rules = []
    for weight in (300, 500, 700):
        rule = kopub_face_rule(weight, found[weight])
        if not rule:
            return None, "not-installed"
        rules.append(rule)
    return rules, "used"


def main():
    chars_path, out_css = sys.argv[1], sys.argv[2]
    mode = sys.argv[3] if len(sys.argv) > 3 else "pretendard"
    text = open(chars_path, encoding="utf-8").read() + ALWAYS
    text = "".join(sorted(set(text)))

    pd_rules, pd_bytes = pretendard_rules(text)
    kopub_status = "skipped"
    all_rules = pd_rules
    if mode == "kopub":
        kb_rules, kopub_status = kopub_rules()
        if kb_rules:
            all_rules = kb_rules + pd_rules

    with open(out_css, "w", encoding="utf-8") as f:
        f.write("\n".join(all_rules) + "\n")

    # gate.mjs가 읽을 사이드카 — 이번 빌드에서 KoPub을 실제로 썼는지(build.mjs가 재계산하지 않도록)
    status_path = os.path.join(os.path.dirname(os.path.abspath(out_css)), ".font-mode.json")
    with open(status_path, "w", encoding="utf-8") as f:
        json.dump({"mode": mode, "kopub": kopub_status}, f)

    if mode == "kopub" and kopub_status == "not-installed":
        # build.mjs가 stdout만 이어서 console.log로 보여주므로 여기 남겨야 사용자 눈에 띈다.
        print(
            "경고: meta.font가 \"kopub\"이지만 이 PC에 KoPubWorld Dotum(Light/Medium/Bold)이 설치돼 있지 않아 "
            "Pretendard로 대체합니다. 설치: https://www.kopus.org/biz-electronic-font2/ (등록 필요)"
        )
    suffix = f", KoPub {kopub_status}" if mode == "kopub" else ""
    print(f"fonts: {len(text)} glyphs, {pd_bytes // 1024} KB (5 weights){suffix}")


if __name__ == "__main__":
    main()
