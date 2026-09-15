"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import {
  LayoutDashboard,
  Users,
  FileBarChart,
  Settings,
} from "lucide-react";

import { Brand } from "@/components/landing/brand";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { UserMenu } from "@/components/ui/user-menu";
import { RoleGate } from "@/components/RoleGate";

const sidebarLinks = [
  {
    href: "/teacher/dashboard",
    label: "Tableau de bord",
    icon: LayoutDashboard,
  },
  { href: "/teacher/students", label: "Mes élèves", icon: Users },
  { href: "/teacher/reports", label: "Rapports", icon: FileBarChart },
  { href: "/teacher/settings", label: "Paramètres", icon: Settings },
];

export default function TeacherLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const profile = useQuery(api.profiles.getCurrentProfile);

  // Role guard: redirect non-teacher users away
  useEffect(() => {
    if (profile === undefined) return;
    if (profile === null) return;
    if (profile.role !== "professeur" && profile.role !== "admin") {
      if (profile.role === "parent") {
        router.replace("/parent/dashboard");
      } else if (profile.role === "student") {
        router.replace("/student/home");
      } else {
        router.replace("/login");
      }
    }
  }, [profile, router]);

  // L'espace professeur, qu'un `admin` traverse pour dépanner — comme partout
  // ailleurs dans ce dépôt.
  return (
    <RoleGate allow={["professeur", "admin"]}>
      <SidebarProvider>
        <Sidebar>
          <SidebarHeader>
            <div className="flex items-center gap-2 px-2 py-2">
              <Brand size="sm" />
              <span className="ml-auto rounded bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                Professeur
              </span>
            </div>
          </SidebarHeader>

          <SidebarContent>
            <SidebarGroup>
              <SidebarGroupContent>
                <SidebarMenu>
                  {sidebarLinks.map((link) => {
                    const isActive =
                      pathname === link.href ||
                      pathname.startsWith(`${link.href}/`);
                    const Icon = link.icon;
                    return (
                      <SidebarMenuItem key={link.href}>
                        <SidebarMenuButton
                          isActive={isActive}
                          render={<Link href={link.href} />}
                          className={isActive ? "bg-amber-50 text-amber-800 font-semibold border-r-2 border-amber-600 rounded-none transition-all duration-200" : ""}
                        >
                          <Icon className={isActive ? "text-amber-600" : ""} />
                          <span>{link.label}</span>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    );
                  })}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          </SidebarContent>

          <SidebarFooter>
            <UserMenu
              profileHref="/teacher/settings"
              settingsHref="/teacher/settings"
              fallbackLabel="Professeur"
            />
          </SidebarFooter>
        </Sidebar>

        <SidebarInset>
          <header className="flex h-16 items-center gap-2 border-b bg-background px-4">
            <SidebarTrigger />
            <div className="text-sm font-medium text-gray-500">
              Espace professeur
            </div>
          </header>
          <main className="flex-1 p-4 lg:p-8">{children}</main>
        </SidebarInset>
      </SidebarProvider>
    </RoleGate>
  );
}
