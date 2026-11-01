#!/usr/bin/env python3
"""Regenerate HAUL Pilots order_alert.wav / .caf (professional ~3.2s chime)."""

from __future__ import annotations

import array
import math
import os
import subprocess
import wave

SR = 22050
DUR = 3.2
N = int(SR * DUR)

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))


def add_tone(samples, freq, start, length, amp=0.42, attack=0.008, hold=0.06, decay=0.45, sustain=0.08):
    i0 = int(start * SR)
    i1 = min(N, int((start + length) * SR))
    for i in range(i0, i1):
        local = (i - i0) / SR
        if local < attack:
            e = local / attack
        elif local < attack + hold:
            e = 1.0
        elif local < attack + hold + decay:
            x = (local - attack - hold) / decay
            e = 1.0 - x * (1.0 - sustain)
        else:
            rem = local - attack - hold - decay
            e = max(0.0, sustain * (1.0 - rem / 0.25))
        s = math.sin(2 * math.pi * freq * local)
        s += 0.28 * math.sin(2 * math.pi * freq * 2 * local)
        s += 0.12 * math.sin(2 * math.pi * freq * 3 * local)
        samples[i] += amp * e * s


def main() -> None:
    samples = [0.0] * N
    add_tone(samples, 988.0, 0.00, 0.55, amp=0.48, hold=0.04, decay=0.38)
    add_tone(samples, 784.0, 0.28, 0.70, amp=0.44, hold=0.05, decay=0.48)
    add_tone(samples, 659.25, 0.52, 0.80, amp=0.42, hold=0.06, decay=0.55)
    add_tone(samples, 523.25, 0.78, 0.95, amp=0.40, hold=0.08, decay=0.65)
    add_tone(samples, 440.0, 1.55, 0.45, amp=0.46, hold=0.08, decay=0.30)
    add_tone(samples, 554.37, 1.95, 0.55, amp=0.44, hold=0.08, decay=0.40)
    add_tone(samples, 659.25, 2.40, 0.75, amp=0.36, hold=0.10, decay=0.60)

    peak = max(abs(x) for x in samples) or 1.0
    gain = 0.86 / peak
    pcm = array.array('h', (int(max(-0.95, min(0.95, x * gain)) * 32767) for x in samples))

    def write(path: str) -> None:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with wave.open(path, 'w') as w:
            w.setnchannels(1)
            w.setsampwidth(2)
            w.setframerate(SR)
            w.writeframes(pcm.tobytes())
        print('wrote', path, os.path.getsize(path))

    wav = os.path.join(ROOT, 'assets', 'sounds', 'order_alert.wav')
    write(wav)
    for rel in (
        'modules/incoming-alert/android/src/main/res/raw/order_alert.wav',
        'modules/incoming-alert/android/src/main/res/raw/incoming_order_alarm.wav',
        'android/app/src/main/res/raw/order_alert.wav',
        'android/app/src/main/res/raw/incoming_order_alarm.wav',
    ):
        path = os.path.join(ROOT, rel)
        if os.path.isdir(os.path.dirname(path)):
            write(path)

    caf = os.path.join(ROOT, 'assets', 'sounds', 'order_alert.caf')
    try:
        subprocess.run(
            ['ffmpeg', '-y', '-i', wav, '-c:a', 'pcm_s16le', caf],
            check=True,
            capture_output=True,
        )
        print('wrote', caf, os.path.getsize(caf))
    except (OSError, subprocess.CalledProcessError) as exc:
        print('caf skipped:', exc)


if __name__ == '__main__':
    main()
