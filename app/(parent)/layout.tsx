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
import { KidSwitcher } from "@/components/parent/kid-switcher";
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
  { href: "/parent/dashboard", label: "Tableau de bord", icon: LayoutDashboard },
  { href: "/parent/children", label: "Mes enfants", icon: Users },
  { href: "/parent/reports", label: "Rapports", icon: FileBarChart },
  { href: "/parent/settings", label: "Paramètres", icon: Settings },
];

export default function ParentLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const profile = useQuery(api.profiles.getCurrentProfile);

  // Role guard: redirect non-parent users (professeurs/students/admins) away
  useEffect(() => {
    if (profile === undefined || profile === null) return;
    if (profile.role === "professeur") {
      router.replace("/teacher/dashboard");
    } else if (profile.role === "admin") {
      router.replace("/admin/dashboard");
    } else if (profile.role === "student") {
      router.replace("/student/home");
    }
  }, [profile, router]);

  const roleLabel = "Parent";

  // L'espace parent. `tuteur` n'est pas un rôle mais une RELATION
  // (`studentGuardians.relation`) : un tuteur légal porte le rôle `parent`.
  return (
    <RoleGate allow={["parent", "admin"]}>
      <SidebarProvider>
        <Sidebar>
          <SidebarHeader>
            <div className="flex items-center gap-2 px-2 py-2">
              <Brand size="sm" />
              <span className="ml-auto rounded bg-lime-100 px-2 py-0.5 text-xs font-medium text-lime-800">
                {roleLabel}
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
                          className={isActive ? "bg-lime-50 text-lime-800 font-semibold border-r-2 border-lime-600 rounded-none transition-all duration-200" : ""}
                        >
                          <Icon className={isActive ? "text-lime-600" : ""} />
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
              profileHref="/parent/settings"
              settingsHref="/parent/settings"
              fallbackLabel={roleLabel}
            />
          </SidebarFooter>
        </Sidebar>

        <SidebarInset>
          <header className="flex h-16 items-center gap-2 border-b bg-background px-4">
            <SidebarTrigger />
            <div className="text-sm font-medium text-gray-500">Espace {roleLabel.toLowerCase()}</div>
            <div className="ml-auto">
              <KidSwitcher />
            </div>
          </header>
          <main className="flex-1 p-4 lg:p-8">{children}</main>
        </SidebarInset>
      </SidebarProvider>
    </RoleGate>
  );
}
