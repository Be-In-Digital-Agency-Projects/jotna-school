"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { FileText, GraduationCap, LayoutDashboard, Users } from "lucide-react";

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
  { href: "/directeur/dashboard", label: "Mon école", icon: LayoutDashboard },
  { href: "/directeur/comptes", label: "Comptes", icon: Users },
  { href: "/directeur/eleves", label: "Élèves", icon: GraduationCap },
  { href: "/directeur/factures", label: "Factures", icon: FileText },
];

/**
 * L'espace du directeur — SON école, pas la plateforme.
 *
 * DISTINCT DE `/admin`, ET CE N'EST PAS UN DÉTAIL. `/admin` administre toutes
 * les écoles, y compris deux concurrentes d'une même ville ; ici tout est cadré
 * sur les écoles que `schoolStaff` rattache à l'appelant, et le cadrage vit côté
 * serveur dans `access.callerAuthorityOverSchool`. Cette barre latérale n'est
 * que du confort : chaque fonction Convex porte sa propre garde.
 *
 * `admin` EST ADMIS, comme dans tous les espaces du dépôt, pour dépanner. Il n'y
 * verra aucune école — `schoolAccounts.mySchools` ne lui en rend aucune, parce
 * qu'il n'en dirige aucune — et c'est la bonne réponse : il a `/admin` pour ça.
 */
export default function DirecteurLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();

  return (
    <RoleGate allow={["directeur", "admin"]}>
      <SidebarProvider>
        <Sidebar>
          <SidebarHeader>
            <div className="flex items-center gap-2 px-2 py-2">
              <Brand size="sm" />
              <span className="ml-auto rounded bg-indigo-100 px-2 py-0.5 text-xs font-medium text-indigo-800">
                Direction
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
                          className={
                            isActive
                              ? "bg-indigo-50 text-indigo-800 font-semibold border-r-2 border-indigo-600 rounded-none transition-all duration-200"
                              : ""
                          }
                        >
                          <Icon className={isActive ? "text-indigo-600" : ""} />
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
              profileHref="/directeur/dashboard"
              settingsHref="/directeur/dashboard"
              fallbackLabel="Direction"
            />
          </SidebarFooter>
        </Sidebar>

        <SidebarInset>
          <header className="flex h-16 items-center gap-2 border-b bg-background px-4">
            <SidebarTrigger />
            <div className="text-sm font-medium text-gray-500">
              Espace direction
            </div>
          </header>
          <main className="flex-1 p-4 lg:p-8">{children}</main>
        </SidebarInset>
      </SidebarProvider>
    </RoleGate>
  );
}
