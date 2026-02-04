# Add Logo Link to Year End Donation Letters

## Tasks
- [ ] Add logoLink state variable to EndOfYearLetterModal.tsx
- [ ] Add Logo Link input field in the Organization Information section of the modal
- [ ] Update the POST request in the modal to include logoLink in the body
- [ ] Update the API route app/api/contacts/send-year-end-letters/route.ts to accept logoLink and include it in letterData
- [ ] Modify the pdfUrl generation to include logoLink as a query parameter
- [ ] Update the PDF generation route app/api/year-end-letters/[filename]/route.ts to accept logoLink from query params
- [ ] Add code to fetch the logo image and add it to the PDF at the top, with appropriate size adjustment
- [ ] Test the implementation

## Notes
- Logo will be displayed at the top of the PDF, centered above the charity name
- Size will be adjusted to fit within reasonable bounds (e.g., max 100px height, maintaining aspect ratio)
- If logo fetch fails, PDF generation should continue without the logo
