import { requirePageUser } from "@/lib/server/auth";
import { signedUrl } from "@/lib/server/storage";
import { PageHeader } from "@/components/ui";
import { ProfileForm } from "@/components/ProfileForm";

export default async function ProfilePage() {
  const { business } = await requirePageUser();
  const logoUrl = business.logo_path ? await signedUrl("assets", business.logo_path, 3600).catch(() => null) : null;
  return (
    <>
      <PageHeader
        title="Business profile"
        subtitle="Claude only uses facts from here and from your request. It never invents prices, hours or offers."
      />
      <ProfileForm profile={business} logoUrl={logoUrl} />
    </>
  );
}
