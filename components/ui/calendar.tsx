"use client"

import * as React from "react"
import { addYears, format, startOfMonth } from "date-fns"
import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
} from "lucide-react"
import { DayPicker, useDayPicker, useNavigation, type CaptionProps } from "react-day-picker"

import { cn } from "@/lib/utils"
import { buttonVariants } from "@/components/ui/button"

function CalendarCaption({ displayMonth }: CaptionProps) {
  const { previousMonth, nextMonth, goToMonth } = useNavigation()
  const { fromDate, toDate } = useDayPicker()

  const previousYear = startOfMonth(addYears(displayMonth, -1))
  const nextYear = startOfMonth(addYears(displayMonth, 1))

  const isBeforeMin = fromDate ? previousYear < startOfMonth(fromDate) : false
  const isAfterMax = toDate ? nextYear > startOfMonth(toDate) : false
  const navButtonClassName = cn(
    buttonVariants({ variant: "ghost", size: "icon" }),
    "size-8 rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
  )

  return (
    <div className="flex w-full items-center gap-2 px-1">
      <div className="flex items-center gap-0.5">
        <button
          type="button"
          onClick={() => goToMonth(previousYear)}
          disabled={isBeforeMin}
          className={navButtonClassName}
          aria-label="Go to previous year"
        >
          <ChevronsLeft className="size-4" />
        </button>
        <button
          type="button"
          onClick={() => previousMonth && goToMonth(previousMonth)}
          disabled={!previousMonth}
          className={navButtonClassName}
          aria-label="Go to previous month"
        >
          <ChevronLeft className="size-4" />
        </button>
      </div>
      <div className="flex-1 text-center text-sm font-semibold text-foreground">
        {format(displayMonth, "MMMM yyyy")}
      </div>
      <div className="flex items-center gap-0.5">
        <button
          type="button"
          onClick={() => nextMonth && goToMonth(nextMonth)}
          disabled={!nextMonth}
          className={navButtonClassName}
          aria-label="Go to next month"
        >
          <ChevronRight className="size-4" />
        </button>
        <button
          type="button"
          onClick={() => goToMonth(nextYear)}
          disabled={isAfterMax}
          className={navButtonClassName}
          aria-label="Go to next year"
        >
          <ChevronsRight className="size-4" />
        </button>
      </div>
    </div>
  )
}

function Calendar({
  className,
  classNames,
  showOutsideDays = true,
  ...props
}: React.ComponentProps<typeof DayPicker>) {
  const currentYear = new Date().getFullYear()

  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      captionLayout={props.captionLayout ?? "buttons"}
      fromYear={props.fromYear ?? currentYear - 100}
      toYear={props.toYear ?? currentYear + 25}
      className={cn("p-3", className)}
      classNames={{
        months: "flex flex-col sm:flex-row gap-2",
        month: "flex flex-col gap-3",
        caption: "flex justify-center pt-1 pb-2 relative items-center w-full border-b",
        caption_label: "text-sm font-medium",
        nav: "flex items-center gap-1",
        nav_button: cn(
          buttonVariants({ variant: "outline" }),
          "size-7 bg-transparent p-0 opacity-50 hover:opacity-100"
        ),
        nav_button_previous: "absolute left-1",
        nav_button_next: "absolute right-1",
        table: "w-full border-collapse space-x-1",
        head_row: "flex",
        head_cell:
          "text-muted-foreground rounded-md w-8 font-normal text-[0.8rem]",
        row: "flex w-full mt-2",
        cell: cn(
          "relative p-0 text-center text-sm focus-within:relative focus-within:z-20 [&:has([aria-selected])]:bg-accent [&:has([aria-selected].day-range-end)]:rounded-r-md",
          props.mode === "range"
            ? "[&:has(>.day-range-end)]:rounded-r-md [&:has(>.day-range-start)]:rounded-l-md first:[&:has([aria-selected])]:rounded-l-md last:[&:has([aria-selected])]:rounded-r-md"
            : "[&:has([aria-selected])]:rounded-md"
        ),
        day: cn(
          buttonVariants({ variant: "ghost" }),
          "size-8 p-0 font-normal aria-selected:opacity-100"
        ),
        day_range_start:
          "day-range-start aria-selected:bg-primary aria-selected:text-primary-foreground",
        day_range_end:
          "day-range-end aria-selected:bg-primary aria-selected:text-primary-foreground",
        day_selected:
          "bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground focus:bg-primary focus:text-primary-foreground",
        day_today: "bg-accent text-accent-foreground",
        day_outside:
          "day-outside text-muted-foreground aria-selected:text-muted-foreground",
        day_disabled: "text-muted-foreground opacity-50",
        day_range_middle:
          "aria-selected:bg-accent aria-selected:text-accent-foreground",
        day_hidden: "invisible",
        ...classNames,
      }}
      components={{
        IconLeft: ({ className, ...props }) => (
          <ChevronLeft className={cn("size-4", className)} {...props} />
        ),
        IconRight: ({ className, ...props }) => (
          <ChevronRight className={cn("size-4", className)} {...props} />
        ),
        Caption: CalendarCaption,
      }}
      {...props}
    />
  )
}

export { Calendar }
