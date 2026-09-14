"""Generate a styled PDF version of the X API feedback doc for Alaa."""
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import mm
from reportlab.lib.colors import HexColor, black, white
from reportlab.lib.enums import TA_LEFT
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
    PageBreak, KeepTogether, HRFlowable, Preformatted,
)

OUTPUT = r"C:\Users\worka\spectre-app\.claude\docs\x-api-feedback-alaa.pdf"

# Spectre palette — warm white on near-black, with restrained accent tones
BG_BLACK = HexColor("#09090b")
TEXT_PRIMARY = HexColor("#0f172a")
TEXT_SECONDARY = HexColor("#475569")
TEXT_MUTED = HexColor("#64748b")
ACCENT = HexColor("#1d4ed8")
CODE_BG = HexColor("#0f172a")
CODE_FG = HexColor("#e2e8f0")
DIVIDER = HexColor("#cbd5e1")
TABLE_HEAD_BG = HexColor("#0f172a")
TABLE_ROW_ALT = HexColor("#f1f5f9")
BULL = HexColor("#10b981")

styles = getSampleStyleSheet()

title_style = ParagraphStyle(
    "TitleCustom",
    parent=styles["Title"],
    fontName="Helvetica-Bold",
    fontSize=22,
    leading=26,
    textColor=TEXT_PRIMARY,
    spaceAfter=6,
    alignment=TA_LEFT,
)

subtitle_style = ParagraphStyle(
    "Subtitle",
    parent=styles["Normal"],
    fontName="Helvetica",
    fontSize=10,
    textColor=TEXT_MUTED,
    leading=14,
    spaceAfter=14,
)

h1_style = ParagraphStyle(
    "H1",
    parent=styles["Heading1"],
    fontName="Helvetica-Bold",
    fontSize=15,
    leading=19,
    textColor=TEXT_PRIMARY,
    spaceBefore=16,
    spaceAfter=8,
)

body_style = ParagraphStyle(
    "BodyCustom",
    parent=styles["BodyText"],
    fontName="Helvetica",
    fontSize=10.5,
    leading=15,
    textColor=TEXT_PRIMARY,
    spaceAfter=8,
)

muted_style = ParagraphStyle(
    "Muted",
    parent=body_style,
    textColor=TEXT_SECONDARY,
)

label_style = ParagraphStyle(
    "Label",
    parent=body_style,
    fontName="Helvetica-Bold",
    fontSize=10,
    textColor=TEXT_PRIMARY,
    spaceAfter=4,
)

code_style = ParagraphStyle(
    "Code",
    parent=styles["Code"],
    fontName="Courier",
    fontSize=8.5,
    leading=12,
    textColor=CODE_FG,
    backColor=CODE_BG,
    leftIndent=10,
    rightIndent=10,
    spaceBefore=6,
    spaceAfter=10,
    borderPadding=(8, 10, 8, 10),
)


def divider():
    return HRFlowable(
        width="100%", thickness=0.5, color=DIVIDER,
        spaceBefore=8, spaceAfter=10,
    )


def code_block(code_text):
    return Preformatted(code_text, code_style)


def section(number, title_text):
    return Paragraph(f"{number}. {title_text}", h1_style)


def build_doc():
    doc = SimpleDocTemplate(
        OUTPUT,
        pagesize=A4,
        leftMargin=22 * mm,
        rightMargin=22 * mm,
        topMargin=20 * mm,
        bottomMargin=20 * mm,
        title="X API Feedback",
        author="Gleb",
        subject="Data shape improvements for X API backend",
    )

    story = []

    # Header
    story.append(Paragraph("X API Feedback", title_style))
    story.append(Paragraph(
        "Data shape improvements for <b>/get_official_tweets</b> and "
        "<b>/search_tweets</b><br/>"
        "<font color='#64748b'>To: Alaa &nbsp;&nbsp;|&nbsp;&nbsp; From: Gleb "
        "&nbsp;&nbsp;|&nbsp;&nbsp; 2026-04-09</font>",
        subtitle_style,
    ))
    story.append(divider())

    story.append(Paragraph(
        "We integrated the X API into the trading app's token page X feed. "
        "A few data-shape issues are making it hard to render the feed "
        "accurately. Flagging them in priority order.",
        body_style,
    ))

    # Section 1 — Retweet metrics
    story.append(section(1, "Retweets return 0 for likes and comments"))
    story.append(Paragraph(
        "The RT record carries only a partial <b>retweets</b> count; "
        "<b>likes</b> and <b>comments</b> are always 0, and <b>views</b> is "
        "<font face='Courier'>\"0\"</font> or <font face='Courier'>\"1\"</font>. "
        "Users see <font face='Courier'>0 | 29 | 0</font> on every retweet, "
        "which looks broken.",
        body_style,
    ))
    story.append(Paragraph(
        "<b>Fix:</b> either (a) copy the source post's engagement metrics "
        "onto the RT record, or (b) embed the full source post under a "
        "<font face='Courier'>retweeted_tweet</font> key so we can render "
        "proper counts.",
        body_style,
    ))
    story.append(Paragraph("Current response:", label_style))
    story.append(code_block(
        '{\n'
        '  "tweet_id": "2041985053693976614",\n'
        '  "tweet_text": "RT @Spectre__AI: Tick-tock new website...",\n'
        '  "likes": 0,\n'
        '  "retweets": 29,\n'
        '  "comments": 0,\n'
        '  "views": "1"\n'
        '}'
    ))
    story.append(Paragraph("Expected:", label_style))
    story.append(code_block(
        '{\n'
        '  "tweet_id": "2041985053693976614",\n'
        '  "tweet_text": "RT @Spectre__AI: Tick-tock new website...",\n'
        '  "retweeted_tweet": {\n'
        '    "tweet_id": "2041935585875476640",\n'
        '    "username": "Spectre__AI",\n'
        '    "likes": 65,\n'
        '    "retweets": 29,\n'
        '    "comments": 25,\n'
        '    "views": "1409"\n'
        '  }\n'
        '}'
    ))
    story.append(Paragraph(
        "Right now we work around this by scanning the full feed for a "
        "matching original post via normalized text matching. Fragile and "
        "only works when the source is already in our result set.",
        muted_style,
    ))

    # Section 2 — in_reply_to_tweet_id / conversation_id
    story.append(section(2, "No in_reply_to_tweet_id / conversation_id field"))
    story.append(Paragraph(
        "Replies have no parent tweet ID or conversation ID. We can only "
        "match replies to parents by extracting "
        "<font face='Courier'>@handle</font> from the tweet text, which "
        "fails in two common cases.",
        body_style,
    ))
    story.append(Paragraph(
        "<b>Bug A - multi-user threads:</b> Spectre posted "
        "<font face='Courier'>@CryptoWizardd @Gyokeres_eth Way more!</font> - "
        "a reply inside a thread. We have no way to tell which of the two "
        "tagged users is the actual parent. We ended up treating both as "
        "parents, which is a guess.",
        body_style,
    ))
    story.append(Paragraph(
        "<b>Bug B - self-replies (worse):</b> When the project replies to "
        "its OWN tweet, X drops the <font face='Courier'>@handle</font> "
        "prefix entirely. Example: "
        "<font face='Courier'>https://x.com/Spectre__AI/status/2042210023409881464</font>",
        body_style,
    ))
    story.append(Paragraph("Current response:", label_style))
    story.append(code_block(
        '{\n'
        '  "tweet_id": "2042210023409881464",\n'
        '  "tweet_text": "Rhetorical but we will type this out -\n'
        '                 this will power the Spectre AI upcoming new App.",\n'
        '  "username": "Spectre__AI",\n'
        '  "likes": 3,\n'
        '  "retweets": 0,\n'
        '  "comments": 0\n'
        '}'
    ))
    story.append(Paragraph(
        "No reply indicator at all. From our side it looks identical to a "
        "standalone post, so we render it as a \"Project Post\" instead of "
        "a \"Reply\", and users see a reply without the original tweet it's "
        "responding to. There is no client-side fix.",
        muted_style,
    ))
    story.append(Paragraph(
        "<b>Fix:</b> forward Twitter API v2's "
        "<font face='Courier'>referenced_tweets[]</font> "
        "(where <font face='Courier'>type: \"replied_to\"</font>), "
        "<font face='Courier'>in_reply_to_user_id</font>, and "
        "<font face='Courier'>conversation_id</font>. Twitter already "
        "provides these - they just need to pass through your scraper.",
        body_style,
    ))

    # Section 3 — context_type
    story.append(section(3, "Thread-context tweets are mixed into the feed with no flag"))
    story.append(Paragraph(
        "<font face='Courier'>/get_official_tweets?username=Spectre__AI</font> "
        "returns 29 tweets, but 8 of them are from <b>third parties</b> "
        "(BlackholeDEX, adam3us, WatcherGuru, Grayscale, neutanent, Invubu, "
        "Gyokeres_eth, FrankLambeek) pulled in as thread parents because "
        "Spectre replied to them.",
        body_style,
    ))
    story.append(Paragraph(
        "There is no flag distinguishing:",
        body_style,
    ))
    story.append(Paragraph(
        "&bull; &nbsp; Spectre's own posts<br/>"
        "&bull; &nbsp; Spectre's retweets<br/>"
        "&bull; &nbsp; Spectre's replies<br/>"
        "&bull; &nbsp; Third-party parent tweets (thread context)",
        body_style,
    ))
    story.append(Paragraph(
        "We had to infer the third category by checking whether any Spectre "
        "reply's <font face='Courier'>replyingTo</font> handle matches. That "
        "is brittle.",
        body_style,
    ))
    story.append(Paragraph("<b>Fix:</b> add a context_type field:", body_style))
    story.append(code_block(
        '{ "context_type": "authored" }        // Spectre\'s own post\n'
        '{ "context_type": "retweet" }         // Spectre retweeted this\n'
        '{ "context_type": "reply" }           // Spectre replied to this\n'
        '{ "context_type": "thread_parent" }   // Thread context, not authored'
    ))

    # Section 4 — views type
    story.append(section(4, "views field type is inconsistent"))
    story.append(Paragraph(
        "Sometimes it is a string (<font face='Courier'>\"1409\"</font>), "
        "sometimes a number (<font face='Courier'>1406</font>). Pick one. "
        "We are currently <font face='Courier'>parseInt</font>-ing defensively "
        "on every tweet.",
        body_style,
    ))

    # Section 5 — pagination
    story.append(section(5, "No pagination, max_results, or cursor"))
    story.append(Paragraph(
        "We get 29 tweets and do not know if that is the limit or the full "
        "set. Please add <font face='Courier'>max_results</font> query param "
        "and <font face='Courier'>next_cursor</font> in the response. Useful "
        "for loading more on scroll.",
        body_style,
    ))

    # Section 6 — rate limits
    story.append(section(6, "No rate limit headers"))
    story.append(Paragraph(
        "When the upstream hits a limit we just see a 502. Please forward X "
        "API's <font face='Courier'>x-rate-limit-remaining</font> and "
        "<font face='Courier'>x-rate-limit-reset</font> headers so we can "
        "back off client-side instead of spamming.",
        body_style,
    ))

    # Priority table
    story.append(section("", "Priority order"))
    table_data = [
        ["#", "Issue", "Severity", "Effort"],
        ["1", "Retweet engagement metrics", "High - breaks UI today", "Small"],
        ["2", "in_reply_to_tweet_id", "Medium - fixes thread match", "Small"],
        ["3", "context_type flag", "Medium - fixes filtering", "Medium"],
        ["4", "views type consistency", "Low - easy fix", "Tiny"],
        ["5", "Pagination + cursor", "Low - nice to have", "Medium"],
        ["6", "Rate limit headers", "Low - nice to have", "Tiny"],
    ]
    col_widths = [10 * mm, 75 * mm, 55 * mm, 25 * mm]
    table = Table(table_data, colWidths=col_widths, hAlign="LEFT")
    table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), TABLE_HEAD_BG),
        ("TEXTCOLOR", (0, 0), (-1, 0), white),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (-1, 0), 9),
        ("FONTSIZE", (0, 1), (-1, -1), 9),
        ("FONTNAME", (0, 1), (-1, -1), "Helvetica"),
        ("TEXTCOLOR", (0, 1), (-1, -1), TEXT_PRIMARY),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [white, TABLE_ROW_ALT]),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("TOPPADDING", (0, 0), (-1, -1), 7),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
        ("LEFTPADDING", (0, 0), (-1, -1), 9),
        ("RIGHTPADDING", (0, 0), (-1, -1), 9),
        ("LINEBELOW", (0, 0), (-1, 0), 0.5, DIVIDER),
    ]))
    story.append(table)
    story.append(Spacer(1, 14))

    story.append(divider())
    story.append(Paragraph(
        "Let me know if you want to jump on a call to walk through the "
        "trading dashboard and see exactly where each one bites us.",
        muted_style,
    ))

    doc.build(story)
    print(f"PDF generated: {OUTPUT}")


if __name__ == "__main__":
    build_doc()
