/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";
import React, { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import DateInput from "@/components/ui/date-input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { GraduationCap } from "lucide-react";
import {
  useContactDetailsQuery,
  useCreateStudentRoleMutation,
} from "@/lib/query/student-roles/useStudentRole";

// Updated to match database schema enums
const programs = [
  { value: "LH", label: "LH" },
  { value: "LLC", label: "LLC" },
  { value: "ML", label: "ML" },
  { value: "Kollel", label: "Kollel" },
  { value: "Madrich", label: "Madrich" },
] as const;

const tracks = [
  { value: "Alef", label: "Alef" },
  { value: "Bet", label: "Bet" },
  { value: "Gimmel", label: "Gimmel" },
  { value: "Dalet", label: "Dalet" },
  { value: "Heh", label: "Heh" },
  { value: "March Draft", label: "March Draft" },
  { value: "August Draft", label: "August Draft" },
  { value: "Room & Board", label: "Room & Board" },
  { value: "Other Draft", label: "Other Draft" },
] as const;

const trackDetails = [
  { value: "Full Year", label: "Full Year" },
  { value: "Fall", label: "Fall" },
  { value: "Spring", label: "Spring" },
  { value: "Until Pesach", label: "Until Pesach" },
] as const;

const statuses = [
  { value: "Student", label: "Student" },
  { value: "Active Soldier", label: "Active Soldier" },
  { value: "Staff", label: "Staff" },
  { value: "Withdrew", label: "Withdrew" },
  { value: "Transferred Out", label: "Transferred Out" },
  { value: "Left Early", label: "Left Early" },
  { value: "Asked to Leave", label: "Asked to Leave" },
] as const;

const machzors = [
  { value: "10.5", label: "10.5" },
  { value: "10", label: "10" },
  { value: "9.5", label: "9.5" },
  { value: "9", label: "9" },
  { value: "8.5", label: "8.5" },
  { value: "8", label: "8" },
] as const;

const currentYear = new Date().getFullYear();
const years = Array.from({ length: currentYear - 2000 + 6 }, (_, i) => {
  const year = 2000 + i;
  return { value: `${year}-${year + 1}`, label: `${year}-${year + 1}` };
}).reverse();

const programTracks = {
  LH: ["Alef", "Bet", "Gimmel", "Dalet", "Heh"],
  LLC: ["March Draft", "August Draft", "Room & Board", "Other Draft"],
  Kollel: [], // No tracks for Kollel
  Madrich: [], // No tracks for Madrich
  ML: ["Alef", "Bet"],
};

// Programs that don't require tracks
const programsWithoutTracks = ["Kollel", "Madrich"];

const studentRoleSchema = z
  .object({
    contactId: z.coerce.number().positive("Contact ID is required"),
    program: z.enum(["LH", "LLC", "ML", "Kollel", "Madrich"], {
      required_error: "Program is required",
    }),
    track: z
      .enum([
        "Alef",
        "Bet",
        "Gimmel",
        "Dalet",
        "Heh",
        "March Draft",
        "August Draft",
        "Room & Board",
        "Other Draft",
      ])
      .optional(), // Track is now optional
    trackDetail: z
      .enum(["Full Year", "Fall", "Spring", "Until Pesach"])
      .optional(),
    status: z.enum(
      [
        "Student",
        "Active Soldier",
        "Staff",
        "Withdrew",
        "Transferred Out",
        "Left Early",
        "Asked to Leave",
      ],
      {
        required_error: "Status is required",
      }
    ),
    machzor: z.enum(["10.5", "10", "9.5", "9", "8.5", "8"]).optional(),
    year: z.string().min(1, "Year is required"),
    startDate: z.string().optional(),
    endDate: z.string().optional(),
    isActive: z.boolean().default(true), // Note: still in schema but not used in form
    additionalNotes: z.string().optional(),
  })
  .refine(
    (data) => {
      // Track is required for programs that have tracks
      if (!programsWithoutTracks.includes(data.program) && !data.track) {
        return false;
      }
      return true;
    },
    {
      message: "Track is required for this program",
      path: ["track"],
    }
  )
  .refine(
    (data) => {
      if (data.startDate && data.endDate) {
        return new Date(data.startDate) <= new Date(data.endDate);
      }
      return true;
    },
    {
      message: "End date must be after start date",
      path: ["endDate"],
    }
  )
  .refine(
    (data) => {
      if (data.startDate) {
        const parts = data.startDate.split("-");
        return parts[0] && parts[0].length === 4;
      }
      return true;
    },
    {
      message: "Start date year must be 4 digits",
      path: ["startDate"],
    }
  )
  .refine(
    (data) => {
      if (data.endDate) {
        const parts = data.endDate.split("-");
        return parts[0] && parts[0].length === 4;
      }
      return true;
    },
    {
      message: "End date year must be 4 digits",
      path: ["endDate"],
    }
  );

type StudentRoleFormData = z.infer<typeof studentRoleSchema>;

interface StudentRoleDialogProps {
  contactId: number;
  contactName?: string;
  contactEmail?: string;
  triggerButton?: React.ReactNode;
}

export default function StudentRoleDialog(props: StudentRoleDialogProps) {
  const { contactId, triggerButton } = props;
  const [open, setOpen] = useState(false);

  const { data: contactData, isLoading: isLoadingContact } =
    useContactDetailsQuery(contactId);

  const createStudentRoleMutation = useCreateStudentRoleMutation();

  const form = useForm({
    resolver: zodResolver(studentRoleSchema),
    defaultValues: {
      contactId,
      program: undefined,
      track: undefined,
      trackDetail: "Full Year" as const, // Default track detail
      status: "Student" as const, // Default status
      machzor: undefined,
      year: `${currentYear}-${currentYear + 1}`,
      startDate: "",
      endDate: "",
      isActive: true,
      additionalNotes: "",
    },
  });

  // Function to get default track based on program
  const getDefaultTrack = (program: string) => {
    switch (program) {
      case "LH":
      case "ML":
        return "Alef";
      case "LLC":
        return "March Draft";
      default:
        return undefined;
    }
  };

  // Function to get default track detail based on track
  const getDefaultTrackDetail = (track: string) => {
    return track === "Bet" ? "Until Pesach" : "Full Year";
  };

  const resetForm = () => {
    form.reset({
      contactId,
      program: undefined,
      track: undefined,
      trackDetail: "Full Year" as const,
      status: "Student" as const,
      machzor: undefined,
      year: `${currentYear}-${currentYear + 1}`,
      startDate: "",
      endDate: "",
      isActive: true,
      additionalNotes: "",
    });
  };

  const onSubmit = async (data: StudentRoleFormData) => {
    try {
      // Filter out undefined track for programs that don't require it
      const submitData = {
        ...data,
        ...(data.track === undefined ? {} : { track: data.track })
      };
      
      await createStudentRoleMutation.mutateAsync(submitData as any);
      resetForm();
      setOpen(false);
    } catch (error) {
      console.error("Error creating enrollment:", error);
    }
  };

  const handleOpenChange = (newOpen: boolean) => {
    setOpen(newOpen);
    if (!newOpen) {
      resetForm();
    }
  };

  const selectedProgram = form.watch("program");
  const selectedTrack = form.watch("track");
  const selectedTrackDetail = form.watch("trackDetail");
  const selectedStatus = form.watch("status");
  const selectedMachzor = form.watch("machzor");
  const selectedYear = form.watch("year");

  // Handle program change to set default track
  useEffect(() => {
    if (selectedProgram) {
      const defaultTrack = getDefaultTrack(selectedProgram);
      if (defaultTrack) {
        form.setValue("track", defaultTrack as any);
        // Set default track detail based on the default track
        const defaultTrackDetail = getDefaultTrackDetail(defaultTrack);
        form.setValue("trackDetail", defaultTrackDetail as any);
      } else {
        // Clear track for programs without tracks
        form.setValue("track", undefined);
      }
    }
  }, [selectedProgram, form]);

  // Handle track change to set default track detail
  useEffect(() => {
    if (selectedTrack) {
      const defaultTrackDetail = getDefaultTrackDetail(selectedTrack);
      form.setValue("trackDetail", defaultTrackDetail as any);
    }
  }, [selectedTrack, form]);

  const programRequiresTrack = selectedProgram && !programsWithoutTracks.includes(selectedProgram);
  const availableTracks = programTracks[selectedProgram || ""] || [];

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        {triggerButton || (
          <Button size="sm" variant="outline" className="border-dashed">
            <GraduationCap className="w-4 h-4 mr-2" />
            Add Enrollment
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add Enrollment</DialogTitle>
          <DialogDescription>
            {isLoadingContact ? (
              "Loading contact details..."
            ) : (
              <div>
                {contactData?.activeStudentRoles &&
                  contactData.activeStudentRoles.length > 0 && (
                    <div className="mt-2">
                      <span className="text-sm text-muted-foreground">
                        Current enrollments:{" "}
                        {contactData.activeStudentRoles
                          .map((role) => `${role.program} (${role.year})`)
                          .join(", ")}
                      </span>
                    </div>
                  )}
              </div>
            )}
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              {/* Year */}
              <FormField
                control={form.control}
                name="year"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Year *</FormLabel>
                    <Select
                      onValueChange={field.onChange}
                      value={field.value}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select year" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent className="max-h-[200px]">
                        {years.map((year) => (
                          <SelectItem key={year.value} value={year.value}>
                            {year.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Program */}
              <FormField
                control={form.control}
                name="program"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Program *</FormLabel>
                    <Select
                      onValueChange={field.onChange}
                      value={field.value}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select program" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {programs.map((program) => (
                          <SelectItem key={program.value} value={program.value}>
                            {program.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              {/* Track - conditional rendering and requirements */}
              <FormField
                control={form.control}
                name="track"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      Track {programRequiresTrack && "*"}
                    </FormLabel>
                    <Select
                      onValueChange={field.onChange}
                      value={field.value}
                      disabled={!programRequiresTrack}
                    >
                      <FormControl>
                        <SelectTrigger className={!programRequiresTrack ? "text-muted-foreground bg-muted" : ""}>
                          <SelectValue 
                            placeholder={
                              !programRequiresTrack 
                                ? "Not applicable" 
                                : "Select track"
                            } 
                          />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {availableTracks.map((track) => (
                          <SelectItem key={track} value={track}>
                            {track}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Track Detail */}
              <FormField
                control={form.control}
                name="trackDetail"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Track Detail</FormLabel>
                    <Select
                      onValueChange={field.onChange}
                      value={field.value}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select track detail" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {trackDetails.map((detail) => (
                          <SelectItem key={detail.value} value={detail.value}>
                            {detail.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            {/* Status - moved before dates */}
            <div className="grid grid-cols-1 gap-4">
              <FormField
                control={form.control}
                name="status"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Status *</FormLabel>
                    <Select
                      onValueChange={field.onChange}
                      value={field.value}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select status" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {statuses.map((status) => (
                          <SelectItem key={status.value} value={status.value}>
                            {status.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              {/* Start Date */}
              <FormField
                control={form.control}
                name="startDate"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Start Date</FormLabel>
                    <FormControl>
                      <DateInput {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* End Date */}
              <FormField
                control={form.control}
                name="endDate"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>End Date</FormLabel>
                    <FormControl>
                      <DateInput {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            {/* Machzor - visible only when program is LLC */}
            {selectedProgram === "LLC" && (
              <div className="grid grid-cols-1 gap-4">
                <FormField
                  control={form.control}
                  name="machzor"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Machzor</FormLabel>
                      <Select
                        onValueChange={field.onChange}
                        value={field.value}
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Select machzor" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {machzors.map((machzor) => (
                            <SelectItem key={machzor.value} value={machzor.value}>
                              {machzor.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            )}

            {/* Additional Notes */}
            <FormField
              control={form.control}
              name="additionalNotes"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Additional Notes</FormLabel>
                  <FormControl>
                    <Textarea
                      {...field}
                      placeholder="Additional notes about this enrollment"
                      rows={3}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Enrollment Summary */}
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mt-6">
              <h4 className="font-medium text-blue-900 mb-2">Enrollment Summary</h4>
              <div className="text-sm text-blue-800 space-y-1">
                <div>Year: {selectedYear}</div>
                <div>
                  Program:{" "}
                  {selectedProgram
                    ? programs.find((p) => p.value === selectedProgram)?.label
                    : "Not selected"}
                </div>
                {programRequiresTrack && (
                  <div>
                    Track:{" "}
                    {selectedTrack
                      ? tracks.find((t) => t.value === selectedTrack)?.label
                      : "Not selected"}
                  </div>
                )}
                {selectedTrackDetail && (
                  <div>
                    Track Detail:{" "}
                    {trackDetails.find((td) => td.value === selectedTrackDetail)
                      ?.label}
                  </div>
                )}
                <div>
                  Status:{" "}
                  {selectedStatus
                    ? statuses.find((s) => s.value === selectedStatus)?.label
                    : "Not selected"}
                </div>
                {form.watch("startDate") && (
                  <div>
                    Start Date:{" "}
                    {new Date(form.watch("startDate") as any).toLocaleDateString()}
                  </div>
                )}
                {form.watch("endDate") && (
                  <div>
                    End Date:{" "}
                    {new Date(form.watch("endDate") as any).toLocaleDateString()}
                  </div>
                )}
                {selectedProgram === "LLC" && selectedMachzor && (
                  <div>
                    Machzor: {machzors.find((m) => m.value === selectedMachzor)?.label}
                  </div>
                )}
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex justify-end space-x-2 pt-4 border-t">
              <Button
                type="button"
                variant="outline"
                onClick={() => handleOpenChange(false)}
                disabled={createStudentRoleMutation.isPending}
              >
                Cancel
              </Button>
              <Button
                type="button"
                onClick={form.handleSubmit(onSubmit)}
                disabled={createStudentRoleMutation.isPending || isLoadingContact}
                className="text-white"
              >
                {createStudentRoleMutation.isPending ? "Adding..." : "Add Enrollment"}
              </Button>
            </div>
          </div>
        </Form>
      </DialogContent>
    </Dialog>
  );
}