#!/usr/bin/env bash
# bash qa.sh out/video.mp4 [samples_per_sec=4]
# Automated gates on the FINAL file + contact sheets for visual review. Read every sheet it writes.
set -u
f="$1"; sps="${2:-4}"; base="${f%.*}"; mkdir -p "${base}-qa"
echo "== ffprobe"
ffprobe -v error -show_entries stream=codec_type,codec_name,width,height,r_frame_rate,nb_frames,duration,sample_rate,channels -of compact "$f"
echo "== blackdetect (d>=0.3s, pix_th 0.10)"
ffmpeg -hide_banner -nostats -i "$f" -vf "blackdetect=d=0.3:pix_th=0.10" -an -f null - 2>&1 | grep -o 'black_start.*' || echo "none"
echo "== freezedetect (static >= 2s)"
ffmpeg -hide_banner -nostats -i "$f" -vf "freezedetect=n=0.001:d=2" -an -f null - 2>&1 | grep -oE 'freeze_(start|duration|end).*' || echo "none"
if ffprobe -v error -select_streams a -show_entries stream=index -of csv=p=0 "$f" | grep -q .; then
  echo "== loudness (EBU R128)"
  ffmpeg -hide_banner -nostats -i "$f" -af ebur128=peak=true -f null - 2>&1 | sed -n '/Summary:/,$p' | grep -E 'I:|LRA:|Peak:'
  echo "== audio/video length"
  ffprobe -v error -show_entries stream=codec_type,duration -of csv=p=0 "$f"
fi
echo "== contact sheets (${sps} samples/sec, 6x5 per sheet, timecode burned in)"
dur=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$f")
# Timecode font: QA_FONT, else the first common system font found. It is copied next to the sheets and
# referenced by a relative path, because a Windows drive letter ("C:") breaks ffmpeg's filter syntax.
font=""
for c in "${QA_FONT:-}" /usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf /usr/share/fonts/dejavu/DejaVuSans-Bold.ttf          /System/Library/Fonts/Supplemental/Arial\ Bold.ttf /Library/Fonts/Arial\ Bold.ttf          /c/Windows/Fonts/arialbd.ttf C:/Windows/Fonts/arialbd.ttf; do
  if [ -n "$c" ] && [ -f "$c" ]; then font="$c"; break; fi
done
if [ -n "$font" ]; then
  cp "$font" "${base}-qa/.font.ttf"
  stamp="drawtext=fontfile=${base}-qa/.font.ttf:text='%{pts\:hms}':x=6:y=6:fontsize=18:fontcolor=yellow:box=1:boxcolor=black@0.6,"
else
  echo "(no font found - set QA_FONT=/path/to/font.ttf for burned-in timecode)"; stamp=""
fi
ffmpeg -hide_banner -loglevel error -y -i "$f" -vf "fps=${sps},scale=320:-2,${stamp}tile=6x5:padding=4:color=gray" "${base}-qa/sheet-%02d.png"
rm -f "${base}-qa/.font.ttf"
ls "${base}-qa"/sheet-*.png
echo "samples: $(awk -v d="$dur" -v s="$sps" 'BEGIN{n=d*s; print (n==int(n))?n:int(n)+1}') over ${dur}s"
