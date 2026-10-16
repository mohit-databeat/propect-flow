"use client";

import { useState } from "react";
import type { Clarification } from "@prospect/shared";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";

export function ClarificationCard({ clarification, onResolve }: { clarification: Clarification; onResolve: (answer: string) => Promise<void> }) {
  const [answer, setAnswer] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (value: string) => {
    if (!value.trim() || loading) return;
    setLoading(true);
    try {
      await onResolve(value.trim());
      setAnswer("");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm text-slate-800">{clarification.question}</p>
        <Badge tone={clarification.severity === "BLOCKING" ? "danger" : "warning"}>{clarification.severity}</Badge>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <input
          value={answer}
          onChange={(e) => setAnswer(e.target.value)}
          placeholder="Type your answer…"
          className="min-w-0 flex-1 rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
          onKeyDown={(e) => {
            if (e.key === "Enter") void submit(answer);
          }}
        />
        <Button variant="secondary" disabled={loading || !answer.trim()} onClick={() => submit(answer)}>
          Answer
        </Button>
        {clarification.proposedDefault ? (
          <Button variant="ghost" disabled={loading} onClick={() => submit(clarification.proposedDefault!)}>
            Accept default: “{clarification.proposedDefault}”
          </Button>
        ) : null}
      </div>
    </div>
  );
}
