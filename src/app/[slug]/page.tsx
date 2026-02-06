import { Metadata } from "next";
import { notFound } from "next/navigation";
import { lookupSlug } from "@/lib/slugLookup";
import SlugBookingClient from "./SlugBookingClient";

/**
 * Dynamic route: /abc-salon
 *
 * Resolves the salon slug server-side, then renders the booking
 * engine client component with the resolved ownerUid.
 */

interface SlugPageProps {
  params: Promise<{ slug: string }>;
}

// Generate dynamic metadata (SEO) from the salon data
export async function generateMetadata({ params }: SlugPageProps): Promise<Metadata> {
  const { slug } = await params;
  const result = await lookupSlug(slug);

  if (!result.found || !result.salonName) {
    return {
      title: "Salon Not Found - BMS Pro Pink",
      description: "The salon you're looking for could not be found.",
    };
  }

  return {
    title: `Book an Appointment - ${result.salonName}`,
    description: `Book your appointment online with ${result.salonName}. Easy online booking available 24/7.`,
    openGraph: {
      title: `Book an Appointment - ${result.salonName}`,
      description: `Book your appointment online with ${result.salonName}.`,
      type: "website",
    },
  };
}

export default async function SlugPage({ params }: SlugPageProps) {
  const { slug } = await params;

  // Server-side slug resolution
  const result = await lookupSlug(slug);

  if (!result.found || !result.ownerUid) {
    notFound();
  }

  // Pass resolved data to client component
  return (
    <SlugBookingClient
      ownerUid={result.ownerUid}
      salonName={result.salonName || "Salon"}
      salonColors={result.salonData?.colors}
    />
  );
}
