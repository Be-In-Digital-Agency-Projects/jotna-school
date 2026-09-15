"use client";

import { useState, useEffect, useMemo } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import {
  AlertTriangle,
  CheckCircle2,
  DollarSign,
  Save,
  Zap,
  Calculator,
} from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import { refusalMessage } from "@/lib/refusalMessage";

/**
 * Admin AI Settings (Decisions 4, 45, 56, 69, 70, 76, 95).
 * Restricted to role='admin' (server-side via getSettings).
 */
export default function AdminAiSettingsPage() {
  const profile = useQuery(api.profiles.getCurrentProfile);
  const settings = useQuery(api.settings.index.getSettings);
  const summary = useQuery(api.settings.index.getMonthSpendSummary, {});
  const incidents = useQuery(api.settings.index.listRecentIncidents, {
    limit: 10,
  });
  const updateSettings = useMutation(api.settings.index.updateSettings);

  const [budget, setBudget] = useState<number | "">("");
  const [economy, setEconomy] = useState(false);
  const [dailyMore, setDailyMore] = useState<number | "">("");
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  // Calculator state
  const [mau, setMau] = useState(100);
  const [engagement, setEngagement] = useState(70);

  useEffect(() => {
    if (settings) {
      setBudget(settings.aiMonthlyBudgetUsd);
      setEconomy(settings.economyMode);
      setDailyMore(settings.dailyMoreLimitPerKid);
    }
  }, [settings]);

  if (profile === undefined || settings === undefined) {
    return (
      <div className="p-8 text-gray-500">Chargement des paramètres...</div>
    );
  }
  if (profile === null || profile.role !== "admin") {
    return (
      <div className="p-8 text-red-600">Accès refusé — admin uniquement.</div>
    );
  }

  const budgetUsd = typeof budget === "number" ? budget : 0;
  const spent = summary?.total ?? 0;
  const pct = budgetUsd > 0 ? (spent / budgetUsd) * 100 : 0;
  const tier =
    pct >= 110
      ? "hard_reject"
      : pct >= 100
        ? "cache_only"
        : pct >= 95
          ? "kill_kid"
          : pct >= 90
            ? "economy_auto"
            : pct >= 80
              ? "warn"
              : "normal";
  const tierColor: Record<string, string> = {
    normal: "bg-green-100 text-green-700 border-green-300",
    warn: "bg-amber-100 text-amber-700 border-amber-300",
    economy_auto: "bg-orange-100 text-orange-700 border-orange-300",
    kill_kid: "bg-red-100 text-red-700 border-red-300",
    cache_only: "bg-red-200 text-red-800 border-red-400",
    hard_reject: "bg-red-300 text-red-900 border-red-500",
  };

  const today = new Date().getUTCDate();
  const daysInMonth = new Date(
    new Date().getUTCFullYear(),
    new Date().getUTCMonth() + 1,
    0,
  ).getUTCDate();
  const projection =
    today > 0 ? (spent / today) * daysInMonth : 0;

  // Cost projection calculator (Decision 70)
  const projectedMonthlyCost = useMemo(() => {
    const wau = (mau * engagement) / 100;
    const sessionsPerWeek = 3;
    const callsPerSession = 2.4;
    const costPerCall = 0.06;
    return wau * sessionsPerWeek * callsPerSession * 4.3 * costPerCall;
  }, [mau, engagement]);

  const chartData = Object.entries(
    (summary?.byPurpose ?? {}) as Record<string, { calls: number; cost: number }>,
  ).map(([purpose, v]) => ({
    purpose,
    cost: Number(v.cost.toFixed(2)),
    calls: v.calls,
  }));

  const handleSave = async () => {
    setSaving(true);
    try {
      await updateSettings({
        aiMonthlyBudgetUsd:
          typeof budget === "number" ? budget : undefined,
        economyMode: economy,
        dailyMoreLimitPerKid:
          typeof dailyMore === "number" ? dailyMore : undefined,
      });
      setSavedAt(Date.now());
    } catch (err) {
      alert(refusalMessage(err, "Erreur lors de la sauvegarde."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">⚙️ AI Gateway</h1>
          <p className="text-sm text-gray-500">
            Budget, modèles, monitoring & garde-fous
          </p>
        </div>
        {economy && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-orange-100 px-3 py-1 text-xs font-bold text-orange-800">
            <Zap className="h-3.5 w-3.5" /> Mode économie actif
          </span>
        )}
      </header>

      {/* Budget summary */}
      <div className={`rounded-2xl border p-5 ${tierColor[tier]}`}>
        <div className="flex items-center gap-3 mb-3">
          {tier === "normal" || tier === "warn" ? (
            <CheckCircle2 className="h-6 w-6" />
          ) : (
            <AlertTriangle className="h-6 w-6" />
          )}
          <h2 className="text-lg font-bold">
            {pct.toFixed(1)}% du budget consommé ({tier.replace("_", " ")})
          </h2>
        </div>
        <div className="grid grid-cols-3 gap-4 text-sm">
          <div>
            <p className="opacity-70">Spent</p>
            <p className="text-xl font-bold">${spent.toFixed(2)}</p>
          </div>
          <div>
            <p className="opacity-70">Budget</p>
            <p className="text-xl font-bold">${budgetUsd}</p>
          </div>
          <div>
            <p className="opacity-70">Projection fin mois</p>
            <p className="text-xl font-bold">${projection.toFixed(2)}</p>
          </div>
        </div>
        <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-white/40">
          <div
            className="h-full bg-current opacity-80 transition-all"
            style={{ width: `${Math.min(100, pct)}%` }}
          />
        </div>
      </div>

      {/* Settings form */}
      <div className="rounded-2xl bg-white p-6 shadow-sm">
        <h3 className="mb-4 text-lg font-bold text-gray-900">Paramètres</h3>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <label className="space-y-1">
            <span className="text-sm font-semibold text-gray-700">
              Budget mensuel (USD)
            </span>
            <input
              type="number"
              min={0}
              step={10}
              value={budget}
              onChange={(e) =>
                setBudget(e.target.value === "" ? "" : Number(e.target.value))
              }
              className="w-full rounded-xl border border-gray-300 px-3 py-2"
            />
          </label>
          <label className="space-y-1">
            <span className="text-sm font-semibold text-gray-700">
              Limite "J'en veux encore" / kid / jour
            </span>
            <input
              type="number"
              min={1}
              max={10}
              value={dailyMore}
              onChange={(e) =>
                setDailyMore(
                  e.target.value === "" ? "" : Number(e.target.value),
                )
              }
              className="w-full rounded-xl border border-gray-300 px-3 py-2"
            />
          </label>
          <label className="flex items-center gap-3 rounded-xl border border-gray-300 px-3 py-2">
            <input
              type="checkbox"
              checked={economy}
              onChange={(e) => setEconomy(e.target.checked)}
              className="h-4 w-4"
            />
            <span className="text-sm font-semibold text-gray-700">
              Mode économie (forcé)
            </span>
          </label>
        </div>
        <div className="mt-4 flex items-center justify-between">
          <p className="text-xs text-gray-500">
            Le mode économie s'active automatiquement à partir de 90% du
            budget.
          </p>
          <button
            onClick={handleSave}
            disabled={saving}
            className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-orange-400 to-pink-500 px-5 py-2 text-sm font-bold text-white shadow-md transition-all hover:shadow-lg disabled:opacity-50"
          >
            <Save className="h-4 w-4" />
            {saving ? "..." : savedAt ? "✓ Sauvegardé" : "Sauvegarder"}
          </button>
        </div>
      </div>

      {/* Spend chart */}
      <div className="rounded-2xl bg-white p-6 shadow-sm">
        <h3 className="mb-4 text-lg font-bold text-gray-900">
          📊 Consommation par poste — {summary?.month}
        </h3>
        {chartData.length === 0 ? (
          <p className="py-8 text-center text-gray-400">
            Aucune donnée ce mois.
          </p>
        ) : (
          <div style={{ width: "100%", height: 260 }}>
            <ResponsiveContainer>
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="purpose" />
                <YAxis tickFormatter={(v) => `$${v}`} />
                <Tooltip
                  formatter={(v) => [`$${Number(v).toFixed(2)}`, "Coût"]}
                />
                <Bar dataKey="cost" fill="#f97316" radius={[8, 8, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
        {summary && (
          <div className="mt-3 grid grid-cols-4 gap-3 text-xs">
            <Stat label="Calls" value={summary.calls} />
            <Stat label="Failed" value={summary.failed} />
            <Stat label="Rejected (budget)" value={summary.rejectedBudget} />
            <Stat label="Rejected (quota)" value={summary.rejectedQuota} />
          </div>
        )}
      </div>

      {/* Calculator */}
      <div className="rounded-2xl bg-white p-6 shadow-sm">
        <h3 className="mb-4 inline-flex items-center gap-2 text-lg font-bold text-gray-900">
          <Calculator className="h-5 w-5" /> Calculateur de projection (Decision
          70)
        </h3>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <label className="space-y-1">
            <span className="text-sm font-semibold text-gray-700">
              MAU prévu
            </span>
            <input
              type="number"
              min={1}
              value={mau}
              onChange={(e) => setMau(Number(e.target.value))}
              className="w-full rounded-xl border border-gray-300 px-3 py-2"
            />
          </label>
          <label className="space-y-1">
            <span className="text-sm font-semibold text-gray-700">
              Engagement (% MAU = WAU)
            </span>
            <input
              type="number"
              min={1}
              max={100}
              value={engagement}
              onChange={(e) => setEngagement(Number(e.target.value))}
              className="w-full rounded-xl border border-gray-300 px-3 py-2"
            />
          </label>
        </div>
        <div className="mt-3 rounded-xl bg-gradient-to-r from-orange-50 to-pink-50 p-4">
          <p className="text-sm text-gray-600">
            Coût IA estimé/mois pour <b>{mau}</b> MAU à {engagement}%
            d'engagement :
          </p>
          <p className="text-2xl font-extrabold text-orange-600 mt-1">
            ${projectedMonthlyCost.toFixed(2)}
            <span className="text-sm text-gray-500 ml-2">
              ≈ {Math.round(projectedMonthlyCost * 600)} FCFA
            </span>
          </p>
          <p className="text-xs text-gray-500 mt-1">
            (Hyp: 3 sessions/sem × 2.4 calls/session × $0.06/call)
          </p>
        </div>
      </div>

      {/* Recent incidents */}
      <div className="rounded-2xl bg-white p-6 shadow-sm">
        <h3 className="mb-4 text-lg font-bold text-gray-900">
          🔧 Incidents récents
        </h3>
        {!incidents || incidents.length === 0 ? (
          <p className="py-4 text-center text-gray-400">
            Aucun incident ce mois.
          </p>
        ) : (
          <div className="space-y-2">
            {incidents.map((inc: {
              _id: string;
              createdAt: number;
              purpose: string;
              modelUsed: string;
              costUsd: number;
            }) => (
              <div
                key={inc._id}
                className="flex items-center gap-3 rounded-xl border border-red-100 bg-red-50 px-4 py-2 text-xs"
              >
                <DollarSign className="h-4 w-4 text-red-500" />
                <span className="text-gray-500">
                  {new Date(inc.createdAt).toLocaleString("fr-FR")}
                </span>
                <span className="font-semibold text-gray-900">
                  {inc.purpose}
                </span>
                <span className="ml-auto text-red-700">
                  {inc.modelUsed} · ${inc.costUsd.toFixed(4)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg bg-gray-50 px-3 py-2 text-center">
      <p className="text-gray-500">{label}</p>
      <p className="text-base font-bold text-gray-900">{value}</p>
    </div>
  );
}
