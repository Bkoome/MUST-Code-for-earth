'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { usePipelineStore } from 'app/store/providers/pipeline';
import { fetchMoiInfo } from 'app/lib/api/moi';
import { VERDICT_LABEL, VERDICT_TONE, caseStory, rankCases } from 'app/types/moi';
import type { MoiCase, MoiInfo } from 'app/types/moi';

// Three cases, curated by the ledger itself rather than by hand. The archive
// holds five days where a recorded flood and an observed rainfall extreme meet
// in the same admin-1 unit; these are the three with most to explain, worst
// verdict first. Everything a card says is read out of its own row.
const TOP_N = 3;

export function MoiCards({ cases, rp }: { cases: MoiCase[]; rp: string }) {
  const { openStory } = usePipelineStore();
  const [info, setInfo] = useState<MoiInfo | null>(null);

  useEffect(() => {
    let live = true;
    fetchMoiInfo()
      .then((i) => live && setInfo(i))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);

  // Country names come from the coverage table, the only place the frontend is
  // told them; a case can only come from a country that has a register anyway.
  const countries = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of info?.coverage ?? []) map.set(c.iso3, c.name);
    return map;
  }, [info]);

  const top = useMemo(() => rankCases(cases).slice(0, TOP_N), [cases]);
  if (!top.length) return null;

  const years = Number(rp.replace('yr', ''));

  return (
    <>
      <div className='cards'>
        {top.map((c) => (
          <button
            key={`${c.event_id}-${c.gid}`}
            className='scard'
            onClick={() => openStory(c.start)}
            title={`Open the ${c.start} storymap`}
          >
            <span className={`verdict__chip verdict__chip--${VERDICT_TONE[c.verdict]}`}>
              {VERDICT_LABEL[c.verdict]}
            </span>
            <span className='eyebrow scard__when'>
              {c.start}
              {c.end !== c.start ? ` – ${c.end}` : ''}
            </span>
            <h3>
              {c.region}
              {countries.get(c.iso3) ? `, ${countries.get(c.iso3)}` : ''}
            </h3>
            <p>{caseStory(c, years)}</p>
            <div className='scard__ft'>
              <span>{c.obs_rp ?? 2}-yr rainfall day</span>
              <span>{c.source === 'desinventar' ? 'DesInventar' : c.source}</span>
              <span>no warning record</span>
            </div>
          </button>
        ))}
      </div>
    </>
  );
}
