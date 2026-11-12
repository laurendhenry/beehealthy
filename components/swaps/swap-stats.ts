import type { SwapSuggestion } from "../../types/swaps";

export type SwapStat = {
  label: string;
  from: string;
  to: string;
  fromValue: number;
  toValue: number;
  improvement: boolean;
  change: number;
};

export function parseSwapStats(...sources: string[]): SwapStat[] {
  const parsed = sources.flatMap((source) =>
    source.split(";").flatMap((part) => {
      const match = part.match(
        /^\s*([^:;]+):\s*(-?\d+(?:\.\d+)?\s*[a-zA-Z%]*)\s*(?:→|->)\s*(-?\d+(?:\.\d+)?\s*[a-zA-Z%]*)(?:\s+per\s+100g(?:\s+\([^)]*\))?)?\s*$/i,
      );
      if (!match) return [];

      const from = match[2].trim();
      const to = match[3].trim();
      const fromValue = Number.parseFloat(from);
      const toValue = Number.parseFloat(to);
      const label = match[1].trim();
      const normalizedLabel = label.toLowerCase();
      const higherIsBetter = /fiber|protein/.test(normalizedLabel);
      const lowerIsBetter =
        /sugar|calor|fat|sodium|salt|carb|cholesterol/.test(normalizedLabel);

      return [
        {
          label,
          from,
          to,
          fromValue,
          toValue,
          improvement: higherIsBetter
            ? toValue > fromValue
            : lowerIsBetter
              ? toValue < fromValue
              : false,
          change:
            Math.abs(toValue - fromValue) /
            Math.max(Math.abs(fromValue), Math.abs(toValue), 1),
        },
      ];
    }),
  );

  const unique = new Map<string, SwapStat>();
  for (const stat of parsed) {
    const key = stat.label.toLowerCase();
    const current = unique.get(key);
    if (!current || stat.change > current.change) unique.set(key, stat);
  }

  return [...unique.values()]
    .sort((a, b) => b.change - a.change)
    .slice(0, 3);
}

export function getSwapExplanation(swap: SwapSuggestion): string {
  return swap.similarity
    .split(";")
    .filter((part) => !parseSwapStats(part).length)
    .join(";")
    .trim()
    .replace(/^[.;,\s]+|[.;,\s]+$/g, "");
}
