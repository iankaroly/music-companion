%% WHAT THIS FILE IS FOR
%%
%% LilyPond knows exactly where it put every notehead and exactly what pitch it
%% is, and the SVG backend will write anything you ask onto the grob's own
%% group element. `output-attributes` is an alist of attributes the SVG backend
%% copies verbatim; nothing else in LilyPond's output carries a pitch.
%%
%% So this file is the whole reason tools/lieder-check.mjs can score a REAL
%% published engraving note for note: it hangs the truth on the ink. Every
%% notehead comes out as
%%
%%   <g class="nh" data-midi="61" data-pos="-3" data-bar="7" data-x0="0"
%%      data-x1="1.3042" data-y0="-0.545" data-y1="0.545" data-fs="0">
%%   <g transform="translate(62.0653, 132.4609)"> <path .../> </g> </g>
%%
%% and the translate is the notehead's left edge at its vertical centre, so the
%% centre of the drawn glyph is translate + (x0+x1)/2, (y0+y1)/2. MEASURED on
%% Webern Op.3 no.1 page 1: all 159 noteheads on the page have at least 62.6%
%% of that box inked in the raster, minimum 0.626, no outliers.
%%
%% It is included with `lilypond -dinclude-settings=<this file>`, which drops it
%% in at top level BEFORE the score. A top-level \layout merges into every
%% \score's own \layout, so it survives musicxml2ly's generated \layout block —
%% CHECKED, on a musicxml2ly conversion of Webern Op.3 no.1: 200 tagged
%% noteheads over two pages, against 200 sounding notes in the MusicXML.
%%
%% A HEAD THAT IS NOT DRAWN COMES OUT AS AN EMPTY GROUP, and that is how the
%% truth stays honest about it. LilyPond writes `<g class="nh" …></g>` with the
%% attributes and NOTHING INSIDE for a grob whose stencil is suppressed — a
%% transparent notehead, which is what musicxml2ly makes of a note it wants
%% sounded and not seen. tools/lieder-check.mjs takes "no translate inside the
%% group" as "not on the page" and drops it, so a suppressed head is never
%% counted as a notehead the reader failed to find.
%%
%% MEASURED, on Abbott's `Just for Today`: 587 tagged heads, one of them an
%% empty group — bar 22, F4 — and the .ly it came from carries
%% `\tweak Stem.transparent ##t \tweak transparent ##t f'2.`, a note musicxml2ly
%% hid to hang a hairpin on. The MusicXML has that note as an ordinary visible
%% note, so this is exactly the case the xml↔ink column exists to show: 587
%% notes in the file, 586 heads on the paper, and the difference is the
%% conversion's doing and not the reader's.

\version "2.26.0"

#(define (mcx-num x) (number->string (exact->inexact x)))

%% data-pos is the grob's staff position in HALF staff spaces, counted from the
%% middle line and positive upwards. It is what lets a head be attached to its
%% own staff without guessing from geometry (centre_y = head_y + pos/2), and it
%% is directly comparable with the reader's `head.step`, which counts the same
%% half spaces from the BOTTOM line: step = pos + 4.
#(define (mcx-nh grob)
  (let* ((ev (ly:grob-property grob 'cause))
         (p (and (ly:stream-event? ev) (ly:event-property ev 'pitch)))
         (st (ly:grob-property grob 'stencil))
         (ex (if (ly:stencil? st) (ly:stencil-extent st X) (cons 0 0)))
         (ey (if (ly:stencil? st) (ly:stencil-extent st Y) (cons 0 0)))
         (col (ly:item-get-column grob))
         (rl (and (ly:grob? col) (ly:grob-property col 'rhythmic-location))))
    (list (cons 'class "nh")
          ;; middle C is 60, as everywhere else in this project: LilyPond counts
          ;; semitones from c' and c' is 60.
          (cons 'data-midi (if (ly:pitch? p) (number->string (+ 60 (ly:pitch-semitones p))) "?"))
          (cons 'data-pos (number->string (ly:grob-staff-position grob)))
          (cons 'data-x0 (mcx-num (car ex))) (cons 'data-x1 (mcx-num (cdr ex)))
          (cons 'data-y0 (mcx-num (car ey))) (cons 'data-y1 (mcx-num (cdr ey)))
          (cons 'data-bar (if (pair? rl) (number->string (car rl)) "?"))
          ;; A grace or cue head is printed smaller. It is real ink and stays in
          ;; the denominator; this is here so the report can say how many of the
          ;; misses were small heads rather than ordinary ones.
          (cons 'data-fs (mcx-num (let ((f (ly:grob-property grob 'font-size)))
                                    (if (number? f) f 0)))))))

%% glyph-name is "clefs.G", "clefs.F", "clefs.C" and a "_change" suffix when the
%% clef is printed mid-line, which is the same clef in a smaller size. The
%% staff position says WHICH clef of that family: a G on -2 is treble, an F on
%% +2 is bass, a C on +2 is tenor and a C on 0 is alto.
#(define (mcx-cl grob)
  (list (cons 'class "cl")
        (cons 'data-glyph (let ((g (ly:grob-property grob 'glyph-name)))
                            (if (string? g) g "?")))
        (cons 'data-pos (number->string (ly:grob-staff-position grob)))))

%% alteration-alist is ((degree . alteration) ...) for the printed signature, so
%% its length is how many sharps or flats and the sign of the first says which.
%% An empty list is a page with no signature printed, which is a reading and not
%% a refusal — see agreeNoKey in scan-key.js.
#(define (mcx-ks grob)
  (let ((a (ly:grob-property grob 'alteration-alist)))
    (list (cons 'class "ks")
          (cons 'data-fifths (number->string
                              (if (null? a) 0
                                  (* (length a) (if (> (cdar a) 0) 1 -1))))))))

%% The staff itself, so a page's staves can be counted from the engraver's own
%% answer rather than from five horizontal rules that happen to line up.
#(define (mcx-ss grob)
  (list (cons 'class "ss")
        (cons 'data-lines (number->string
                           (length (ly:grob-property grob 'line-positions))))))

\layout {
  \context {
    \Score
    \override NoteHead.output-attributes = #mcx-nh
    \override Clef.output-attributes = #mcx-cl
    %% KeyCancellation is deliberately NOT tagged. musicxml2ly sets
    %% printKeyCancellation = ##f, so the naturals that cancel an old signature
    %% are not printed — but the grob still exists, and tagging it would put a
    %% second, phantom `fifths` on a page that prints one signature and would
    %% silently switch the key column off.
    \override KeySignature.output-attributes = #mcx-ks
  }
  \context {
    \Staff
    \override StaffSymbol.output-attributes = #mcx-ss
  }
}
