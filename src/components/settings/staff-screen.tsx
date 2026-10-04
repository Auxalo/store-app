"use client";

import { KeyRound, Pencil, Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  can,
  PERMISSIONS,
  ROLE_PERMISSIONS,
  type Role,
} from "@/auth/permissions";
import { hashPin, needsStrongPin, normalizePin } from "@/auth/pin";
import { refreshStaff } from "@/auth/staff-cache";
import { useProfile } from "@/auth/use-auth";
import { PinDialog } from "@/components/lock/pin-dialog";
import { ResponsiveDialog } from "@/components/shared/responsive-dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { getLocalDb } from "@/db/local/db";
import { api } from "./api";

interface Member {
  id: string;
  name: string;
  username: string;
  role: Role;
  isActive: boolean;
  hasPin?: boolean;
  pinHash?: string;
}

type StaffRole = "manager" | "cashier";
const PASSWORD_MIN = 8;

/** Add people, set their role and PIN, reset a password, switch someone off. Needs internet. */
export function StaffScreen() {
  const t = useTranslations();
  const { role } = useProfile();
  const [staff, setStaff] = useState<Member[] | null>(null);
  const [offline, setOffline] = useState(false);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Member | null>(null);
  const [pinFor, setPinFor] = useState<Member | null>(null);
  const [toggling, setToggling] = useState<Member | null>(null);

  const load = useCallback(async () => {
    const result = await api<{ staff: Member[] }>("/api/staff");
    if (result.ok && result.data) {
      setStaff(result.data.staff);
      setOffline(false);
      void refreshStaff(getLocalDb());
    } else setOffline(true);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (!can(role, "user.manage"))
    return (
      <p className="py-10 text-center text-sm text-muted-foreground">
        {t("settings.noAccess")}
      </p>
    );

  const owner = staff?.find((m) => m.role === "owner");
  const othersHavePins = staff?.some(
    (m) => m.role !== "owner" && (m.hasPin ?? m.pinHash),
  );

  async function setActive(member: Member, isActive: boolean) {
    const result = await api(`/api/staff/${member.id}`, {
      method: "PATCH",
      body: { isActive },
    });
    setToggling(null);
    if (!result.ok) return void toast.error(t("staff.needsInternet"));
    toast.success(t("staff.updated"));
    await load();
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-3">
      {offline ? (
        <p
          role="alert"
          className="rounded-lg border border-destructive/40 p-3 text-sm text-destructive"
        >
          {t("staff.needsInternet")}
        </p>
      ) : null}

      {owner && !(owner.hasPin ?? owner.pinHash) && othersHavePins ? (
        <p
          className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm"
          data-testid="owner-pin-hint"
        >
          {t("staff.ownerNeedsPin")}
        </p>
      ) : null}

      <div className="flex justify-end">
        <Button
          onClick={() => setAdding(true)}
          disabled={offline}
          data-testid="add-staff"
        >
          <Plus aria-hidden />
          {t("staff.add")}
        </Button>
      </div>

      {staff === null && !offline ? <Skeleton className="h-16 w-full" /> : null}
      <ul className="grid gap-2" data-testid="staff-list">
        {staff?.map((m) => (
          <li
            key={m.id}
            className="flex items-center gap-2 rounded-xl border bg-card p-3"
            data-testid="staff-row"
          >
            <div className="min-w-0 flex-1">
              <p className="flex flex-wrap items-center gap-2 font-medium">
                <span className="truncate">{m.name}</span>
                <Badge variant="secondary">{t(`role.${m.role}`)}</Badge>
                {!m.isActive ? (
                  <Badge variant="destructive">{t("staff.inactive")}</Badge>
                ) : null}
              </p>
              <p className="truncate text-xs text-muted-foreground">
                {m.username} ·{" "}
                {(m.hasPin ?? m.pinHash) ? t("pin.hasPin") : t("pin.noPin")}
              </p>
            </div>
            <Button
              variant="ghost"
              size="icon"
              aria-label={t("staff.setPin")}
              onClick={() => setPinFor(m)}
              data-testid="staff-pin"
            >
              <KeyRound aria-hidden />
            </Button>
            {m.role !== "owner" ? (
              <Button
                variant="ghost"
                size="icon"
                aria-label={t("staff.edit")}
                onClick={() => setEditing(m)}
                data-testid="staff-edit"
              >
                <Pencil aria-hidden />
              </Button>
            ) : null}
          </li>
        ))}
      </ul>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("staff.permissions")}</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-muted-foreground">
                <th className="py-1 pe-2" />
                {(["owner", "manager", "cashier"] as const).map((r) => (
                  <th key={r} className="px-2 py-1 text-center font-medium">
                    {t(`role.${r}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {PERMISSIONS.map((p) => (
                <tr key={p} className="border-t">
                  <td className="py-1.5 pe-2">
                    {t(`staff.permissionNames.${p.replace(".", "_")}` as never)}
                  </td>
                  {(["owner", "manager", "cashier"] as const).map((r) => (
                    <td key={r} className="px-2 py-1.5 text-center">
                      {ROLE_PERMISSIONS[r].includes(p) ? "✓" : "–"}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <AddStaffDialog
        open={adding}
        onClose={() => setAdding(false)}
        onDone={load}
      />
      <EditStaffDialog
        member={editing}
        onClose={() => setEditing(null)}
        onDone={load}
        onToggle={(m) => {
          setEditing(null);
          if (m.isActive) setToggling(m);
          else void setActive(m, true);
        }}
      />
      {pinFor ? (
        <PinDialog
          open
          userId={pinFor.id}
          userName={pinFor.name}
          role={pinFor.role}
          onClose={() => {
            setPinFor(null);
            void load();
          }}
        />
      ) : null}

      <AlertDialog
        open={toggling !== null}
        onOpenChange={(o) => !o && setToggling(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("staff.deactivateTitle", { name: toggling?.name ?? "" })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("staff.deactivateBody")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => toggling && void setActive(toggling, false)}
              data-testid="confirm-deactivate"
            >
              {t("staff.deactivate")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function RoleSelect({
  value,
  onChange,
}: {
  value: StaffRole;
  onChange: (r: StaffRole) => void;
}) {
  const t = useTranslations();
  return (
    <Field>
      <FieldLabel>{t("staff.role")}</FieldLabel>
      <Select value={value} onValueChange={(v) => onChange(v as StaffRole)}>
        <SelectTrigger className="w-full" data-testid="staff-role">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="manager">{t("role.manager")}</SelectItem>
          <SelectItem value="cashier">{t("role.cashier")}</SelectItem>
        </SelectContent>
      </Select>
    </Field>
  );
}

function AddStaffDialog({
  open,
  onClose,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  onDone: () => Promise<void>;
}) {
  const t = useTranslations();
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [pin, setPin] = useState("");
  const [staffRole, setStaffRole] = useState<StaffRole>("cashier");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setError(null);
    if (
      name.trim().length < 2 ||
      username.trim().length < 3 ||
      password.length < PASSWORD_MIN
    )
      return setError(t("common.somethingWrong"));
    const cleanPin = pin ? normalizePin(pin, staffRole) : null;
    if (pin && !cleanPin)
      return setError(
        needsStrongPin(staffRole) ? t("pin.invalidStrong") : t("pin.invalid"),
      );
    setBusy(true);
    const result = await api("/api/staff", {
      method: "POST",
      body: {
        name: name.trim(),
        username: username.trim(),
        password,
        role: staffRole,
        ...(cleanPin ? { pin: await hashPin(cleanPin) } : {}),
      },
    });
    setBusy(false);
    if (result.offline) return setError(t("staff.needsInternet"));
    if (result.code === "USERNAME_TAKEN")
      return setError(t("staff.usernameTaken"));
    if (!result.ok) return setError(t("common.somethingWrong"));
    toast.success(t("staff.created"));
    setName("");
    setUsername("");
    setPassword("");
    setPin("");
    onClose();
    await onDone();
  }

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title={t("staff.add")}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="staff-name">{t("staff.name")}</FieldLabel>
            <Input
              id="staff-name"
              value={name}
              maxLength={80}
              onChange={(e) => setName(e.target.value)}
              data-testid="staff-name"
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="staff-username">
              {t("staff.username")}
            </FieldLabel>
            <Input
              id="staff-username"
              value={username}
              autoCapitalize="none"
              autoComplete="off"
              onChange={(e) => setUsername(e.target.value)}
              data-testid="staff-username"
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="staff-password">
              {t("staff.password")}
            </FieldLabel>
            <Input
              id="staff-password"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              data-testid="staff-password"
            />
          </Field>
          <RoleSelect value={staffRole} onChange={setStaffRole} />
          <Field>
            <FieldLabel htmlFor="staff-pin">
              {t("staff.pinOptional")}
            </FieldLabel>
            <Input
              id="staff-pin"
              type="password"
              inputMode="numeric"
              autoComplete="off"
              maxLength={6}
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              data-testid="staff-pin-input"
            />
          </Field>
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
          <Button type="submit" disabled={busy} data-testid="save-staff">
            {t("common.save")}
          </Button>
        </FieldGroup>
      </form>
    </ResponsiveDialog>
  );
}

function EditStaffDialog({
  member,
  onClose,
  onDone,
  onToggle,
}: {
  member: Member | null;
  onClose: () => void;
  onDone: () => Promise<void>;
  onToggle: (m: Member) => void;
}) {
  const t = useTranslations();
  const [name, setName] = useState("");
  const [staffRole, setStaffRole] = useState<StaffRole>("cashier");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!member) return;
    setName(member.name);
    setStaffRole(member.role === "manager" ? "manager" : "cashier");
    setPassword("");
    setError(null);
  }, [member]);

  async function submit() {
    if (!member) return;
    if (name.trim().length < 2 || (password && password.length < PASSWORD_MIN))
      return setError(t("common.somethingWrong"));
    const body: Record<string, unknown> = {};
    if (name.trim() !== member.name) body.name = name.trim();
    if (staffRole !== member.role) body.role = staffRole;
    if (password) body.password = password;
    if (Object.keys(body).length === 0) return onClose();
    const result = await api(`/api/staff/${member.id}`, {
      method: "PATCH",
      body,
    });
    if (!result.ok)
      return setError(
        result.offline ? t("staff.needsInternet") : t("common.somethingWrong"),
      );
    toast.success(t("staff.updated"));
    onClose();
    await onDone();
  }

  return (
    <ResponsiveDialog
      open={member !== null}
      onOpenChange={(o) => !o && onClose()}
      title={t("staff.edit")}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="edit-name">{t("staff.name")}</FieldLabel>
            <Input
              id="edit-name"
              value={name}
              maxLength={80}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
          <RoleSelect value={staffRole} onChange={setStaffRole} />
          <Field>
            <FieldLabel htmlFor="edit-password">
              {t("staff.resetPassword")}
            </FieldLabel>
            <Input
              id="edit-password"
              type="password"
              autoComplete="new-password"
              placeholder={t("staff.newPassword")}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </Field>
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
            <Button
              type="button"
              variant="outline"
              onClick={() => member && onToggle(member)}
              data-testid="toggle-active"
            >
              {member?.isActive ? t("staff.deactivate") : t("staff.activate")}
            </Button>
            <Button type="submit" data-testid="save-edit">
              {t("common.save")}
            </Button>
          </div>
        </FieldGroup>
      </form>
    </ResponsiveDialog>
  );
}
