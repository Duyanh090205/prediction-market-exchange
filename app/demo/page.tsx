import { prisma } from "@/lib/prisma";

// Always render fresh: this is a live snapshot of the book, not a build artifact.
export const dynamic = "force-dynamic";

export const metadata = {
  title: "Order book — read-only demo",
  description:
    "A read-only snapshot of a live contract's order book. No account needed.",
};

function Price({ v }: { v: number | null }) {
  return <span className="tabular-nums">{v === null ? "—" : v}</span>;
}

export default async function DemoPage() {
  const contract = await prisma.contract.findFirst({
    where: { status: "OPEN" },
    orderBy: [{ quotes: { _count: "desc" } }, { id: "desc" }],
    include: {
      quotes: { where: { status: "OPEN" } },
      trades: {
        orderBy: { createdAt: "desc" },
        take: 12,
        select: {
          id: true,
          takerSide: true,
          strike: true,
          size: true,
          createdAt: true,
        },
      },
    },
  });

  // Maker identities are deliberately not shown: this page is public.
  const bids = (contract?.quotes ?? [])
    .filter((q) => q.bid !== null && (q.bidSize ?? 0) > 0)
    .sort((a, b) => (b.bid ?? 0) - (a.bid ?? 0));
  const asks = (contract?.quotes ?? [])
    .filter((q) => q.ask !== null && (q.askSize ?? 0) > 0)
    .sort((a, b) => (a.ask ?? 0) - (b.ask ?? 0));

  const best = {
    bid: bids[0]?.bid ?? null,
    ask: asks[0]?.ask ?? null,
  };
  const spread =
    best.bid !== null && best.ask !== null ? best.ask - best.bid : null;

  return (
    <main className="mx-auto max-w-3xl px-5 py-10">
      <h1 className="text-2xl font-semibold">Order book — read-only</h1>
      <p className="mt-2 text-sm text-neutral-500">
        A live snapshot of one open contract, served without an account. Nothing on
        this page can be traded; the matching engine, margin engine and settlement
        layer live behind the login. Quote makers are not named here because the
        page is public.
      </p>

      {!contract ? (
        <p className="mt-8 rounded border border-neutral-300 p-4 text-sm">
          No open contract right now. The book fills in once a market is created
          and quoted.
        </p>
      ) : (
        <>
          <section className="mt-8">
            <h2 className="text-lg font-medium">{contract.title}</h2>
            <p className="mt-1 text-sm text-neutral-500">
              {contract.description}
            </p>
            <p className="mt-3 text-sm">
              Best bid <Price v={best.bid} /> · best ask <Price v={best.ask} /> ·{" "}
              spread {spread === null ? "—" : spread} · range{" "}
              {contract.minPrice}–{contract.maxPrice}
            </p>
          </section>

          <section className="mt-8 grid gap-6 sm:grid-cols-2">
            <div>
              <h3 className="text-sm font-medium">Bids</h3>
              <table className="mt-2 w-full text-sm">
                <thead className="text-left text-neutral-500">
                  <tr>
                    <th className="font-normal">Price</th>
                    <th className="font-normal">Size</th>
                  </tr>
                </thead>
                <tbody>
                  {bids.length === 0 && (
                    <tr>
                      <td colSpan={2} className="py-2 text-neutral-500">
                        none
                      </td>
                    </tr>
                  )}
                  {bids.map((q) => (
                    <tr key={`b${q.id}`}>
                      <td className="py-1 tabular-nums">{q.bid}</td>
                      <td className="py-1 tabular-nums">{q.bidSize}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div>
              <h3 className="text-sm font-medium">Asks</h3>
              <table className="mt-2 w-full text-sm">
                <thead className="text-left text-neutral-500">
                  <tr>
                    <th className="font-normal">Price</th>
                    <th className="font-normal">Size</th>
                  </tr>
                </thead>
                <tbody>
                  {asks.length === 0 && (
                    <tr>
                      <td colSpan={2} className="py-2 text-neutral-500">
                        none
                      </td>
                    </tr>
                  )}
                  {asks.map((q) => (
                    <tr key={`a${q.id}`}>
                      <td className="py-1 tabular-nums">{q.ask}</td>
                      <td className="py-1 tabular-nums">{q.askSize}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="mt-8">
            <h3 className="text-sm font-medium">Recent fills</h3>
            {contract.trades.length === 0 ? (
              <p className="mt-2 text-sm text-neutral-500">
                No trades on this contract yet.
              </p>
            ) : (
              <table className="mt-2 w-full text-sm">
                <thead className="text-left text-neutral-500">
                  <tr>
                    <th className="font-normal">Side</th>
                    <th className="font-normal">Strike</th>
                    <th className="font-normal">Size</th>
                    <th className="font-normal">When</th>
                  </tr>
                </thead>
                <tbody>
                  {contract.trades.map((t) => (
                    <tr key={t.id}>
                      <td className="py-1">{t.takerSide}</td>
                      <td className="py-1 tabular-nums">{t.strike}</td>
                      <td className="py-1 tabular-nums">{t.size}</td>
                      <td className="py-1 text-neutral-500">
                        {t.createdAt.toISOString().slice(0, 16).replace("T", " ")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </>
      )}

      <p className="mt-10 border-t border-neutral-200 pt-4 text-xs text-neutral-500">
        Built as the engine for a private trading game. It has never taken live
        order flow.{" "}
        <a className="underline" href="/login">
          Sign in
        </a>{" "}
        to trade, or read the{" "}
        <a
          className="underline"
          href="https://github.com/Duyanh090205/prediction-market-exchange"
        >
          source
        </a>
        .
      </p>
    </main>
  );
}
