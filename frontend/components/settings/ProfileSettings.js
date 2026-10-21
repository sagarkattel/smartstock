"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { AVATAR_IDS, Avatar } from "@/components/ui/Avatar";
import { CheckIcon } from "@/components/ui/icons";
import { ErrorBlock, LoadingBlock } from "@/components/ui/StateViews";
import { notify } from "@/lib/notify";
import { useChangePassword, useMe, useUpdateProfile } from "@/lib/queries";

const inputClass =
  "w-full rounded-xl border border-border bg-surface-2/70 px-3.5 py-2.5 text-sm placeholder:text-muted focus:outline-2 focus:outline-focus-ring";

function ProfileForm({ me }) {
  const queryClient = useQueryClient();
  const update = useUpdateProfile();
  const [name, setName] = useState(me.name);
  const [avatar, setAvatar] = useState(me.avatar ?? null);
  const [error, setError] = useState(null);

  const trimmed = name.trim();
  const changed = trimmed !== me.name || avatar !== (me.avatar ?? null);
  const valid = trimmed.length >= 1 && trimmed.length <= 60;

  const save = async (e) => {
    e.preventDefault();
    setError(null);
    try {
      await update.mutateAsync({ display_name: trimmed, avatar });
      await queryClient.invalidateQueries({ queryKey: ["me"] });
      notify("Profile saved.");
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <form onSubmit={save} className="rounded-2xl border border-border bg-surface p-5">
      <h2 className="text-base font-semibold">Your profile</h2>
      <p className="mt-1 text-sm text-muted">Your name and picture are shown at the top of every page.</p>

      <div className="mt-5 flex flex-wrap items-center gap-4">
        <Avatar id={avatar} name={trimmed || me.name} className="size-20" />
        <div className="min-w-0 flex-1">
          <label htmlFor="display-name" className="text-sm font-medium">Name</label>
          <input id="display-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} autoComplete="name" className={`${inputClass} mt-1.5 max-w-md`} />
          <p className="mt-1 text-xs text-muted">Signed in as <span className="font-medium text-foreground">{me.username}</span> (the username cannot be changed here).</p>
        </div>
      </div>

      <fieldset className="mt-6">
        <legend className="text-sm font-medium">Profile picture</legend>
        <div role="radiogroup" aria-label="Profile picture" className="mt-3 grid grid-cols-4 gap-3 sm:grid-cols-8">
          {AVATAR_IDS.map((id, index) => {
            const selected = avatar === id;
            return (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={selected}
                aria-label={`Avatar ${index + 1}`}
                onClick={() => setAvatar(id)}
                className={`relative rounded-full p-1 transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring ${
                  selected ? "ring-2 ring-primary" : "opacity-80 hover:opacity-100"
                }`}
              >
                <Avatar id={id} className="aspect-square w-full" />
                {selected && (
                  <span className="absolute -right-0.5 -bottom-0.5 flex size-5 items-center justify-center rounded-full bg-primary text-primary-foreground">
                    <CheckIcon className="size-3" />
                  </span>
                )}
              </button>
            );
          })}
        </div>
        <button type="button" onClick={() => setAvatar(null)} className="mt-3 text-xs text-muted underline-offset-2 hover:text-foreground hover:underline focus-visible:outline-2 focus-visible:outline-focus-ring">
          Use my initial instead
        </button>
      </fieldset>

      {error && <p role="alert" className="mt-4 rounded-xl bg-danger-surface px-3 py-2 text-sm text-danger">{error}</p>}

      <div className="mt-5 flex justify-end">
        <button
          type="submit"
          disabled={!changed || !valid || update.isPending}
          className="rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring disabled:cursor-not-allowed disabled:opacity-50"
        >
          {update.isPending ? "Saving…" : "Save profile"}
        </button>
      </div>
    </form>
  );
}

function PasswordForm() {
  const change = useChangePassword();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [again, setAgain] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState(null);

  const tooShort = next.length > 0 && next.length < 8;
  const mismatch = again.length > 0 && again !== next;
  const ready = current && next.length >= 8 && again === next && next !== current;

  const save = async (e) => {
    e.preventDefault();
    setError(null);
    try {
      await change.mutateAsync({ current_password: current, new_password: next });
      setCurrent("");
      setNext("");
      setAgain("");
      notify("Password changed. Use it the next time you sign in.");
    } catch (err) {
      setError(err.message);
    }
  };

  const type = show ? "text" : "password";
  return (
    <form onSubmit={save} className="rounded-2xl border border-border bg-surface p-5">
      <h2 className="text-base font-semibold">Password</h2>
      <p className="mt-1 text-sm text-muted">Use at least 8 characters. You stay signed in on this device.</p>

      <div className="mt-5 grid max-w-md gap-4">
        <div>
          <label htmlFor="current-password" className="text-sm font-medium">Current password</label>
          <input id="current-password" type={type} value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" className={`${inputClass} mt-1.5`} />
        </div>
        <div>
          <label htmlFor="new-password" className="text-sm font-medium">New password</label>
          <input id="new-password" type={type} value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" aria-invalid={tooShort} className={`${inputClass} mt-1.5`} />
          {tooShort && <p className="mt-1 text-xs text-danger">Use at least 8 characters.</p>}
        </div>
        <div>
          <label htmlFor="repeat-password" className="text-sm font-medium">Repeat the new password</label>
          <input id="repeat-password" type={type} value={again} onChange={(e) => setAgain(e.target.value)} autoComplete="new-password" aria-invalid={mismatch} className={`${inputClass} mt-1.5`} />
          {mismatch && <p className="mt-1 text-xs text-danger">The passwords do not match.</p>}
        </div>
        <label className="flex items-center gap-2 text-sm text-muted">
          <input type="checkbox" checked={show} onChange={(e) => setShow(e.target.checked)} className="size-4 accent-[var(--primary)]" />
          Show passwords
        </label>
      </div>

      {error && <p role="alert" className="mt-4 rounded-xl bg-danger-surface px-3 py-2 text-sm text-danger">{error}</p>}

      <div className="mt-5 flex justify-end">
        <button
          type="submit"
          disabled={!ready || change.isPending}
          className="rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring disabled:cursor-not-allowed disabled:opacity-50"
        >
          {change.isPending ? "Changing…" : "Change password"}
        </button>
      </div>
    </form>
  );
}

export function ProfileSettings() {
  const me = useMe();
  if (me.isError) return <ErrorBlock error={me.error} onRetry={() => me.refetch()} title="Could not load your profile" />;
  if (!me.data) return <LoadingBlock label="Loading your profile" className="h-80" />;
  return (
    <>
      {/* Keyed on the saved values so the form starts fresh after saving. */}
      <ProfileForm key={`${me.data.name}|${me.data.avatar}`} me={me.data} />
      <PasswordForm />
    </>
  );
}
