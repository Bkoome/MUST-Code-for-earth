<p align="center">
  <img src="public/must-banner.jpg" alt="MUST" width="420" />
</p>

# MUST: Monitoring and Understanding SpatioTemporal Flood Risk

Interactive toolkit for retrospective flood-risk monitoring and decision support
across East Africa, driven by the ECMWF IFS ensemble.

> ECMWF Code for Earth 2026, Africa Stream (ArcX)
> Challenge 41: Missed Opportunities in Flood Disaster Risk Management
> Mentors: Nishadh Kalladath, Masilin Gudoshava, Ahmed Amdihun, Anthony Mwanthi, Katherine Egan, Jessica Keune, Hillary Koros

[![License: Apache 2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)

---

MUST lets analysts replay how flood risk built up over time, day by day and
region by region, and check those forecast signals against what happened on the
ground. It is built as two connected views:

- Calendar index: a calendar where every cell is one forecast day, shaded on a
  probability ramp. Pick an accumulation window and a return period, scrub or
  play through the year, and watch an admin-1 choropleth recolour alongside a
  detail card for the day you land on.
- Storymap: a scrollytelling view where a pinned map reacts as you read through
  an event, from the first forecast signal to the eventual impact.

## Quick start

```bash
yarn install
cp .env.example .env.local     # set NEXT_PUBLIC_TILER_XR_BASE
yarn dev
```

Then open http://localhost:3000.

## Shareable URLs

Every control and calendar day reflects into the address bar, so any view is a
link you can share:

```
/?view=index|story&hazard=flood&window=24h&rp=10yr&date=YYYY-MM-DD
```

## Project layout

```
app/          Next.js 14 application (App Router)
  store/      URL-synced app state
  components/ calendar, choropleth, storymap, shell
  lib/        data client, colour ramp
  styles/     design tokens and component styles
public/       map geometry, story assets, brand banner
```

## Citation

```bibtex
@software{must_2026,
  title   = {{MUST: Monitoring and Understanding SpatioTemporal Flood Risk Toolkit}},
  author  = {Koome, Brian and Ochieng, Mark and Kiluma, Lester and Ashorn, Mikael},
  year    = {2026},
  url     = {https://github.com/Bkoome/MUST-Code-for-earth},
  license = {Apache-2.0},
  note    = {ECMWF Code for Earth 2026, Challenge 41, Africa Stream (ArcX)}
}
```

## License

Licensed under the Apache License 2.0. See [LICENSE](LICENSE).
