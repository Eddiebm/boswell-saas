import { describe, expect, it } from "vitest";
import { discoverVerifyCandidates } from "@/lib/dynamic-verify/discover";

describe("discoverVerifyCandidates", () => {
  it("finds a login route from a POST handler that touches passwords", () => {
    const result = discoverVerifyCandidates([
      {
        path: "src/app/api/login/route.ts",
        content: `
          export async function POST(request: Request) {
            const { email, password } = await request.json();
            const ok = await bcrypt.compare(password, user.passwordHash);
            return Response.json({ token: "..." });
          }
        `,
      },
    ]);

    expect(result.loginCandidates).toHaveLength(1);
    expect(result.loginCandidates[0].loginPath).toBe("/api/login");
    expect(result.loginCandidates[0].confidence).toBe("high");
  });

  it("flags an unguarded GET-by-id handler as a high-confidence resource candidate", () => {
    const result = discoverVerifyCandidates([
      {
        path: "src/app/api/orders/[id]/route.ts",
        content: `
          export async function GET(request: Request, { params }: { params: { id: string } }) {
            const order = await db.select().from(orders).where(eq(orders.id, params.id));
            return Response.json(order);
          }
        `,
      },
    ]);

    expect(result.resourceCandidates).toHaveLength(1);
    expect(result.resourceCandidates[0].resourcePathTemplate).toBe("/api/orders/{id}");
    expect(result.resourceCandidates[0].confidence).toBe("high");
  });

  it("downgrades a GET-by-id handler that already checks the session user", () => {
    const result = discoverVerifyCandidates([
      {
        path: "src/app/api/orders/[id]/route.ts",
        content: `
          export async function GET(request: Request, { params }: { params: { id: string } }) {
            const session = await auth();
            const order = await db.select().from(orders).where(eq(orders.id, params.id));
            if (order.userId !== session.user.id) return new Response("forbidden", { status: 403 });
            return Response.json(order);
          }
        `,
      },
    ]);

    expect(result.resourceCandidates[0].confidence).toBe("low");
  });

  it("ignores GET routes without a dynamic id segment", () => {
    const result = discoverVerifyCandidates([
      {
        path: "src/app/api/orders/route.ts",
        content: `export async function GET() { return Response.json([]); }`,
      },
    ]);

    expect(result.resourceCandidates).toHaveLength(0);
  });

  it("ignores non-route files", () => {
    const result = discoverVerifyCandidates([
      { path: "src/lib/orders.ts", content: "export async function GET() {}" },
    ]);

    expect(result.loginCandidates).toHaveLength(0);
    expect(result.resourceCandidates).toHaveLength(0);
  });
});
