import { useEffect, useState } from "react";
import { fetchAuthSession, signOut } from "aws-amplify/auth";
import { Hub } from "aws-amplify/utils";
import { NavLink } from "react-router-dom";
import { t, tt } from "../i18n";
import LanguageToggle from "./LanguageToggle";

export type NavigationRole = "public" | "competitor" | "committee" | "admin";

interface NavItem {
  to: string;
  label: string;
  end?: boolean;
}

const PUBLIC_NAV: NavItem[] = [
  { to: "/register", label: "ลงทะเบียน / Registration" },
  { to: "/portal", label: "พอร์ทัล / Portal", end: false },
  { to: "/scoreboard", label: "ผลการแข่งขัน / Results" },
];

const COMPETITOR_NAV: NavItem[] = [
  { to: "/register", label: "ลงทะเบียน / Registration" },
  { to: "/portal", label: "สถานะของฉัน / My status", end: false },
  { to: "/scoreboard", label: "ผลการแข่งขัน / Results" },
];

const STAFF_NAV: NavItem[] = [
  { to: "/committee/approvals", label: "ใบสมัคร / Approvals" },
  { to: "/admin", label: "ผู้เข้าแข่งขัน / Competitors" },
  { to: "/committee/scan", label: "ตรวจสภาพ / Inspection" },
  { to: "/admin/lanes", label: "สนาม / Lanes" },
  { to: "/staff/timing", label: "เวลาและโทษ / Timing" },
  { to: "/scoreboard", label: "ผลการแข่งขัน / Results" },
];

const NAV_BY_ROLE: Record<NavigationRole, NavItem[]> = {
  public: PUBLIC_NAV,
  competitor: COMPETITOR_NAV,
  committee: STAFF_NAV,
  admin: STAFF_NAV,
};

const ROLE_LABEL: Record<NavigationRole, string> = {
  public: "PUBLIC",
  competitor: "COMPETITOR",
  committee: "COMMITTEE",
  admin: "ADMIN",
};

function roleFromGroups(groups: unknown): NavigationRole {
  if (!Array.isArray(groups)) return "competitor";
  if (groups.includes("admin")) return "admin";
  if (groups.includes("committee")) return "committee";
  return "competitor";
}

interface NavBarProps {
  onSignOut?: () => void | Promise<void>;
}

/** One role-aware navigation component used on every page. */
export default function NavBar({ onSignOut }: NavBarProps) {
  const [role, setRole] = useState<NavigationRole>("public");

  useEffect(() => {
    let active = true;
    const refreshRole = async () => {
      try {
        const session = await fetchAuthSession();
        const token = session.tokens?.idToken;
        if (active) setRole(token ? roleFromGroups(token.payload["cognito:groups"]) : "public");
      } catch {
        if (active) setRole("public");
      }
    };
    refreshRole();
    const cancel = Hub.listen("auth", () => refreshRole());
    return () => {
      active = false;
      cancel();
    };
  }, []);

  async function handleSignOut(): Promise<void> {
    if (onSignOut) await onSignOut();
    else await signOut();
    setRole("public");
    if (!onSignOut) window.location.assign("/portal");
  }

  const items = NAV_BY_ROLE[role];
  return (
    <nav className="nav-bar" aria-label={`Primary navigation — ${ROLE_LABEL[role]}`}>
      <div className="nav-main">
        <span className={`nav-role nav-role-${role}`}>{ROLE_LABEL[role]}</span>
        <div className="nav-links">
          {items.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end ?? true}
              className={({ isActive }) => (isActive ? "nav-link active" : "nav-link")}
            >
              {tt(item.label)}
            </NavLink>
          ))}
        </div>
      </div>
      <div className="nav-actions">
        <LanguageToggle />
        {role !== "public" && (
          <button type="button" className="secondary nav-signout" onClick={handleSignOut}>
            {t("ออกจากระบบ", "Sign out")}
          </button>
        )}
      </div>
    </nav>
  );
}
