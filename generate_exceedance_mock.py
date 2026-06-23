"""Generate a synthetic, real-shaped daily exceedance calendar for the mock backend.

Output: data/exceedance_calendar.parquet (columns: date, window, rp, p, members,
emdat_match). Same shape as the real product, so swapping is a drop-in replacement.
"""

import math
import os

import pandas as pd

YEARS = [2023, 2024, 2025]
WINDOWS = ["3h", "6h", "12h", "24h", "48h", "72h", "7d"]
RPS = ["2yr", "5yr", "10yr", "20yr", "40yr", "100yr"]

# Longer accumulation windows exceed more readily; rarer return periods less so.
WIN_FACTOR = {"3h": 0.60, "6h": 0.72, "12h": 0.85, "24h": 1.00, "48h": 1.12, "72h": 1.22, "7d": 1.35}
RP_FACTOR = {"2yr": 1.35, "5yr": 1.15, "10yr": 1.00, "20yr": 0.82, "40yr": 0.66, "100yr": 0.50}


def day_prob(year: int, doy: int) -> float:
    """Baseline flood-relevant exceedance, peaking in the two East-African rainy seasons."""
    seasonal = math.exp(-((doy - 110) ** 2) / 1400) + math.exp(-((doy - 310) ** 2) / 1000)
    noise = ((year * 131 + doy * 977) % 1000) / 1000
    return min(1.0, seasonal * 0.75 * (0.45 + noise * 0.75) + noise * 0.10)


def main() -> None:
    rows = []
    for year in YEARS:
        days = 366 if (year % 4 == 0 and year % 100 != 0) or year % 400 == 0 else 365
        for i in range(days):
            date = (pd.Timestamp(year=year, month=1, day=1) + pd.Timedelta(days=i))
            doy = i + 1
            base = day_prob(year, doy)
            # EM-DAT match is a property of the day, not the window/RP: a recorded
            # flood either happened or it didn't. Tie it to the baseline signal.
            emdat = bool(base > 0.62 and (int(date.value // 864e11) % 7 == 0))
            iso = date.strftime("%Y-%m-%d")
            for w in WINDOWS:
                for rp in RPS:
                    p = min(1.0, base * WIN_FACTOR[w] * RP_FACTOR[rp])
                    rows.append(
                        {
                            "date": iso,
                            "window": w,
                            "rp": rp,
                            "p": round(float(p), 4),
                            "members": int(round(p * 51)),
                            "emdat_match": emdat,
                        }
                    )

    df = pd.DataFrame(rows)
    out = os.path.join(os.path.dirname(__file__), "data", "exceedance_calendar.parquet")
    df.to_parquet(out, index=False)
    print(f"wrote {out}  ({len(df):,} rows, {df['date'].nunique()} days)")


if __name__ == "__main__":
    main()
