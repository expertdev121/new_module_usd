"use client";

/**
 * Story / Team-leaderboard tab switcher for the public campaign page.
 *
 * Only shows tabs when both sections have real content to show — a campaign
 * with no story but a team, or a story but no team, just renders that one
 * section directly with no tab bar at all. Both sections are backed by real
 * data (campaign.story, sub-campaign progress), so there's never an empty
 * placeholder tab here.
 */
import { useState } from "react";

type LeaderboardRow = {
  id: number;
  slug: string;
  name: string;
  raisedFormatted: string;
};

export function CampaignTabs({
  story,
  leaderboard,
  primary,
}: {
  story: string | null;
  leaderboard: LeaderboardRow[];
  primary: string;
}) {
  const hasStory = !!story;
  const hasTeam = leaderboard.length > 0;
  const [tab, setTab] = useState<"story" | "team">(hasStory ? "story" : "team");

  if (!hasStory && !hasTeam) return null;

  if (hasStory && !hasTeam) {
    return (
      <div className="mt-8">
        <SectionHeading primary={primary}>Story</SectionHeading>
        <Story story={story!} />
      </div>
    );
  }
  if (!hasStory && hasTeam) {
    return (
      <div className="mt-8">
        <Leaderboard rows={leaderboard} primary={primary} />
      </div>
    );
  }

  return (
    <div className="mt-8">
      <div className="flex gap-1 border-b">
        <TabButton active={tab === "story"} primary={primary} onClick={() => setTab("story")}>
          Story
        </TabButton>
        <TabButton active={tab === "team"} primary={primary} onClick={() => setTab("team")}>
          Team leaderboard
        </TabButton>
      </div>
      <div className="pt-6">{tab === "story" ? <Story story={story!} /> : <Leaderboard rows={leaderboard} primary={primary} />}</div>
    </div>
  );
}

function TabButton({
  active,
  primary,
  onClick,
  children,
}: {
  active: boolean;
  primary: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`border-b-2 px-4 py-2 text-sm font-semibold transition-colors ${
        active ? "" : "border-transparent text-gray-400 hover:text-gray-600"
      }`}
      style={active ? { color: primary, borderColor: primary } : undefined}
    >
      {children}
    </button>
  );
}

function SectionHeading({ primary, children }: { primary: string; children: React.ReactNode }) {
  return (
    <div className="mb-4">
      <h2 className="text-lg font-bold text-gray-900">{children}</h2>
      <div className="mt-2 h-1 w-full rounded-full" style={{ background: primary }} />
    </div>
  );
}

function Story({ story }: { story: string }) {
  return <div className="whitespace-pre-wrap text-[15px] leading-relaxed text-gray-700">{story}</div>;
}

function Leaderboard({ rows, primary }: { rows: LeaderboardRow[]; primary: string }) {
  return (
    <div className="divide-y rounded-lg border">
      {rows.map((r, i) => (
        <a key={r.id} href={`/f/${r.slug}`} className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-gray-50">
          <div className="flex min-w-0 items-center gap-3">
            <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-gray-100 text-xs font-semibold text-gray-600">
              {i + 1}
            </span>
            <span className="truncate font-medium text-gray-900">{r.name}</span>
          </div>
          <span className="shrink-0 text-sm font-semibold" style={{ color: primary }}>
            {r.raisedFormatted}
          </span>
        </a>
      ))}
    </div>
  );
}
