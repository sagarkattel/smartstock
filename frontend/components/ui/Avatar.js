/** Built-in profile pictures. The backend stores only the id ("avatar-1" ... "avatar-8"). */
export const AVATAR_IDS = ["avatar-1", "avatar-2", "avatar-3", "avatar-4", "avatar-5", "avatar-6", "avatar-7", "avatar-8"];

const EYE = "#16172b";

const DRAWINGS = {
  // Sunny face
  "avatar-1": (
    <>
      <rect width="64" height="64" fill="#ffb23e" />
      <circle cx="32" cy="34" r="19" fill="#ffe3a8" />
      <circle cx="25" cy="31" r="2.4" fill={EYE} />
      <circle cx="39" cy="31" r="2.4" fill={EYE} />
      <path d="M24 40q8 8 16 0" stroke={EYE} strokeWidth="2.4" fill="none" strokeLinecap="round" />
      <circle cx="21" cy="38" r="2.6" fill="#ff9f7a" opacity="0.6" />
      <circle cx="43" cy="38" r="2.6" fill="#ff9f7a" opacity="0.6" />
    </>
  ),
  // Cat
  "avatar-2": (
    <>
      <rect width="64" height="64" fill="#7c5cff" />
      <path d="M15 28 18 10l12 9zM49 28 46 10l-12 9z" fill="#f3e8ff" />
      <circle cx="32" cy="36" r="18" fill="#f3e8ff" />
      <circle cx="25" cy="34" r="2.4" fill={EYE} />
      <circle cx="39" cy="34" r="2.4" fill={EYE} />
      <path d="M30 40h4l-2 2.5z" fill="#ff7a9a" />
      <path d="M32 42.5v2.5M28 46q4 2 8 0M14 38l8 1.5M14 43l8-1M50 38l-8 1.5M50 43l-8-1" stroke={EYE} strokeWidth="1.4" fill="none" strokeLinecap="round" />
    </>
  ),
  // Robot
  "avatar-3": (
    <>
      <rect width="64" height="64" fill="#2f8cff" />
      <path d="M32 8v8" stroke="#ffd166" strokeWidth="2.5" strokeLinecap="round" />
      <circle cx="32" cy="8" r="3" fill="#ffd166" />
      <rect x="14" y="16" width="36" height="32" rx="8" fill="#dbe8ff" />
      <rect x="21" y="26" width="8" height="8" rx="2" fill={EYE} />
      <rect x="35" y="26" width="8" height="8" rx="2" fill={EYE} />
      <path d="M24 41h16" stroke={EYE} strokeWidth="2.4" strokeLinecap="round" />
      <rect x="10" y="26" width="4" height="12" rx="2" fill="#a9c6ff" />
      <rect x="50" y="26" width="4" height="12" rx="2" fill="#a9c6ff" />
    </>
  ),
  // Bear
  "avatar-4": (
    <>
      <rect width="64" height="64" fill="#18b6d9" />
      <circle cx="17" cy="19" r="7" fill="#b9814e" />
      <circle cx="47" cy="19" r="7" fill="#b9814e" />
      <circle cx="32" cy="34" r="19" fill="#c98f5c" />
      <ellipse cx="32" cy="41" rx="9" ry="7" fill="#f1d1a8" />
      <circle cx="25" cy="30" r="2.3" fill={EYE} />
      <circle cx="39" cy="30" r="2.3" fill={EYE} />
      <ellipse cx="32" cy="38" rx="3" ry="2.2" fill={EYE} />
      <path d="M32 40v3M28 44q4 2.5 8 0" stroke={EYE} strokeWidth="1.6" fill="none" strokeLinecap="round" />
    </>
  ),
  // Owl
  "avatar-5": (
    <>
      <rect width="64" height="64" fill="#4f6bff" />
      <path d="M14 14l8 6M50 14l-8 6" stroke="#d8c4ff" strokeWidth="4" strokeLinecap="round" />
      <ellipse cx="32" cy="36" rx="19" ry="21" fill="#e4d4ff" />
      <circle cx="24" cy="31" r="8" fill="#fff" />
      <circle cx="40" cy="31" r="8" fill="#fff" />
      <circle cx="25" cy="32" r="3.6" fill={EYE} />
      <circle cx="39" cy="32" r="3.6" fill={EYE} />
      <path d="M28 40h8l-4 6z" fill="#ffb23e" />
      <path d="M22 52q10 6 20 0" stroke="#c4a8f5" strokeWidth="2" fill="none" strokeLinecap="round" />
    </>
  ),
  // Fox
  "avatar-6": (
    <>
      <rect width="64" height="64" fill="#ff6b81" />
      <path d="M12 12l14 14-12 8zM52 12 38 26l12 8z" fill="#ff9f43" />
      <path d="M14 30c0-8 8-12 18-12s18 4 18 12c0 12-8 24-18 24S14 42 14 30z" fill="#ff9f43" />
      <path d="M32 54c-8 0-14-6-16-14 6 2 10 4 16 4s10-2 16-4c-2 8-8 14-16 14z" fill="#fff4e6" />
      <circle cx="25" cy="33" r="2.3" fill={EYE} />
      <circle cx="39" cy="33" r="2.3" fill={EYE} />
      <ellipse cx="32" cy="44" rx="3" ry="2.2" fill={EYE} />
    </>
  ),
  // Alien
  "avatar-7": (
    <>
      <rect width="64" height="64" fill="#1c2a55" />
      <path d="M32 6v9M24 8l4 8M40 8l-4 8" stroke="#6ee7b7" strokeWidth="2" strokeLinecap="round" />
      <path d="M12 30c0-12 9-18 20-18s20 6 20 18c0 14-9 26-20 26S12 44 12 30z" fill="#7fe8b5" />
      <path d="M17 29q6-2 11 4-2 6-9 3-4-3-2-7zM47 29q-6-2-11 4 2 6 9 3 4-3 2-7z" fill={EYE} />
      <path d="M27 46q5 3 10 0" stroke={EYE} strokeWidth="2" fill="none" strokeLinecap="round" />
    </>
  ),
  // Ghost
  "avatar-8": (
    <>
      <rect width="64" height="64" fill="#a577ff" />
      <path d="M14 54V30c0-11 8-19 18-19s18 8 18 19v24l-6-5-6 5-6-5-6 5-6-5z" fill="#ffffff" />
      <ellipse cx="25" cy="30" rx="3" ry="4" fill={EYE} />
      <ellipse cx="39" cy="30" rx="3" ry="4" fill={EYE} />
      <ellipse cx="32" cy="40" rx="3.4" ry="4.2" fill="#6d4bd1" />
      <circle cx="20" cy="37" r="2.6" fill="#ffb3c7" opacity="0.7" />
      <circle cx="44" cy="37" r="2.6" fill="#ffb3c7" opacity="0.7" />
    </>
  ),
};

/** A round profile picture: the chosen avatar, or the person's initial when none is chosen. */
export function Avatar({ id, name = "", className = "size-9" }) {
  const drawing = DRAWINGS[id];
  if (!drawing) {
    return (
      <span
        aria-hidden="true"
        className={`flex shrink-0 items-center justify-center rounded-full bg-primary font-semibold text-primary-foreground ${className}`}
      >
        {name.trim().charAt(0).toUpperCase() || "?"}
      </span>
    );
  }
  return (
    <svg viewBox="0 0 64 64" aria-hidden="true" className={`shrink-0 overflow-hidden rounded-full ${className}`}>
      {drawing}
    </svg>
  );
}
