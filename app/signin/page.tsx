import { signIn } from "@/auth";

export default async function SignInPage({
  searchParams,
}: PageProps<"/signin">) {
  const { callbackUrl } = await searchParams;
  // A single leading slash is not enough: "//evil.com" also starts with "/"
  // and browsers read it as a protocol-relative URL, so that check alone
  // would send someone off-site straight after signing in. Require a second
  // character that is not a slash or backslash.
  const isSafeInternalPath =
    typeof callbackUrl === "string" &&
    callbackUrl.startsWith("/") &&
    !callbackUrl.startsWith("//") &&
    !callbackUrl.startsWith("/\\");
  const redirectTo = isSafeInternalPath ? (callbackUrl as string) : "/";

  return (
    <div className="mx-auto mt-16 max-w-sm space-y-6 text-center">
      <div>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/logo-mark.svg"
          alt=""
          width={80}
          height={80}
          className="mx-auto"
        />
        <h1 className="mt-3 text-2xl font-bold text-ink">
          NFL <span className="text-accent-strong">Predictions</span>
        </h1>
        <p className="mt-2 text-ink-muted">
          Sign in to make your picks, follow the leaderboard, and keep your own
          season.
        </p>
      </div>
      <form
        action={async () => {
          "use server";
          await signIn("google", { redirectTo });
        }}
      >
        <button
          type="submit"
          className="w-full rounded bg-accent px-4 py-2.5 font-semibold text-accent-ink transition-colors hover:bg-accent-strong"
        >
          Sign in with Google
        </button>
      </form>
      <p className="text-xs text-ink-muted">
        Your picks are private to your account. See the{" "}
        <a href="/privacy" className="underline hover:text-ink-soft">
          privacy notice
        </a>
        .
      </p>
    </div>
  );
}
