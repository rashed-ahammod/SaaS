/**
 * Public enquiry form, no sign-in: /enquiry/demo?ref=facebook-page
 * The company shares the link (Facebook page, WhatsApp, a QR code on the shop counter);
 * each send becomes a lead in the CRM. Which forms exist: ENQUIRY_FORMS (src/lib/server/enquiry.ts).
 */
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { EnquiryForm } from "@/components/enquiry-form";
import { enquiryForms, publicForm } from "@/lib/server/enquiry";

export async function generateMetadata(
  props: PageProps<"/enquiry/[form]">,
): Promise<Metadata> {
  const { form: slug } = await props.params;
  const form = enquiryForms().get(slug);
  return {
    title: form ? `${form.nameBn} · ${form.nameEn}` : "Enquiry",
    robots: { index: false },
  };
}

export default async function EnquiryPage(props: PageProps<"/enquiry/[form]">) {
  const { form: slug } = await props.params;
  const form = enquiryForms().get(slug);
  if (!form) notFound();
  const { ref } = await props.searchParams;
  return (
    <EnquiryForm
      form={publicForm(form)}
      shareRef={typeof ref === "string" ? ref.slice(0, 60) : ""}
    />
  );
}
