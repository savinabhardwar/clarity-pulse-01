# Project Compass

IMPORTANT: DIRECTLY IMPLEMENT THE COMPLETE APPLICATION IN THIS SINGLE GENERATION. DO NOT PLAN, EXPLAIN, ASK QUESTIONS, CREATE A ROADMAP, OR IMPLEMENT IN PHASES. Use this prompt as the complete specification and build all required pages, components, interactions, and sample data in one go. Do not stop after creating a partial layout.

Build a Stakeholder Management Dashboard as a complete, polished enterprise web application.

This is primarily a frontend/UI implementation. Use realistic mock/sample data so that all screens and interactions can be demonstrated immediately.

Core Structure

There are multiple Projects.

Each Project is one Module.

There is NO separate module inside a project.

Example projects/modules:

 CX Pass

 Agent Assist

 Knowledge Hub

 Forecasting

The user selects a project/module and manages its stakeholder items.

Each project/module has exactly two tabs:

Features

Implementation

PAGE 1 — Stakeholder Management / Project Selection

Create the main Stakeholder Management page.

Show a clean list/grid of available projects/modules.

Example:

 CX Pass

 Agent Assist

 Knowledge Hub

 Forecasting

Each project should be selectable.

Clicking a project opens its management page.

Use a consistent application shell with:

 Left navigation/sidebar

 Page header

 Main content area

Keep navigation minimal and do not add unnecessary pages.

PAGE 2 — Project Stakeholder Management

When a project is selected, show:

Header

Display the selected project name.

Example:

CX Pass

Below it, show the two tabs:

Features | Implementation

The selected tab must be visually obvious.

FEATURES TAB

Show a table containing Feature items.

Add a prominent:

+ Add Feature

button.

Feature Table Columns

Use these columns:

 Summary

 Description

 Jira Ticket Link

 Status

 Priority

 Comment

 Created By

 Required By Date

 Will Be Done By Date

 Attach Document

 Actions

 History

Use realistic sample records so the table is populated when the application loads.

IMPLEMENTATION TAB

Use the exact same structure as Features, but display Implementation items.

Button:

+ Add Implementation

Use realistic sample implementation records.

ADD / EDIT FORM

The Add button must open a side drawer or modal without leaving the current page.

Fields:

 Summary

 Description

 Jira Ticket Link

 Status

 Priority

 Comment

 Created By

 Required By Date

 Will Be Done By Date

 Attach Document

Use appropriate controls for each field.

Status

The status dropdown must contain both Jira statuses and additional stakeholder statuses.

Include these stakeholder statuses:

 To Do

 In Progress

 Waiting for Spec

 Waiting for confirmation

 Deprioritised

 Reviewing Requirements

 Done

Also include realistic Jira statuses such as:

 To Do

 In Progress

 In Review

 Done

Clearly support both types of statuses in the UI.

Priority

Provide a simple priority dropdown.

Use:

 High

 Medium

 Low

The form must have:

Cancel
Save

Saving should immediately add/update the record in the table.

CRUD

Implement working frontend CRUD interactions using local/mock state.

Every item must support:

 Create

 View

 Edit

 Delete

Use a three-dot Actions menu for each row.

Actions:

 View

 Edit

 Delete

Delete must show a confirmation dialog before removing the item.

ITEM DETAILS

Clicking View or the Summary should open a detail side drawer.

Show all information for the selected item:

 Summary

 Description

 Jira Ticket Link

 Status

 Priority

 Comment

 Created By

 Required By Date

 Will Be Done By Date

 Attachments

Provide Edit and Delete actions.

AUDIT HISTORY

Every item must have a clock/history icon in the table.

Clicking it opens a History side drawer.

Show a chronological audit timeline.

Example:

Item Created
Created by: Alex
Sep 5, 2026 · 10:30 AM

Status Changed
To Do → In Progress
Changed by: Alex
Sep 6, 2026 · 2:15 PM

Priority Changed
Medium → High
Changed by: Sarah
Sep 7, 2026 · 11:20 AM

Comment Updated
Changed by: Sarah
Sep 7, 2026 · 12:05 PM

Every create/edit/delete action should generate an audit entry.

For edits, show:

Field
Previous Value → New Value
Changed By
Date/Time

Do not remove the history when an item is edited.

FILTERS

Place filters above the table.

Include:

Search

Search by Summary.

Status

Multi-select status filter containing:

 Jira statuses

 Stakeholder statuses

Date Range

Provide a custom date range picker:

From Date → To Date

Allow the user to clear filters.

Filters should work together.

ATTACHMENTS

The Attach Document field should support a simple file-upload UI.

After uploading, show:

 File name

 File type

 File size

Allow the user to remove the attachment.

Use mock/local handling for the prototype; no external storage integration is required.

SAMPLE DATA

Populate the application with realistic sample data.

Include enough records to demonstrate:

 Multiple projects

 Features

 Implementation items

 Different statuses

 Different priorities

 Jira ticket links

 Comments

 Different users

 Required dates

 Will Be Done By dates

 Attachments

 Audit history

Do not leave the interface empty.

UI / DESIGN

Create a polished, modern enterprise SaaS interface.

Use:

 Clean sidebar

 Professional typography

 White/light neutral background

 Subtle borders

 Compact data tables

 Clear status badges

 Priority indicators

 Consistent spacing

 Modal/drawer interactions

 Clear primary buttons

 Responsive layout

The application should look like a production-ready internal stakeholder management tool, not a basic CRUD demo.

The table should be designed to handle many columns without looking broken. Use horizontal scrolling where necessary.

IMPORTANT IMPLEMENTATION RULES

BUILD EVERYTHING NOW IN ONE GO.

Do NOT:

 Create a plan first

 Explain what you are going to build

 Ask for clarification

 Build only the landing page

 Build only the table

 Create placeholder pages

 Split the implementation into phases

 Leave TODOs

 Leave major interactions unimplemented

 Add unnecessary features

Directly implement the complete UI and all specified interactions in this generation.

The final result should allow me to immediately:

 Select a project/module.

 Open Features or Implementation.

 Search and filter items.

 Add an item.

 View an item.

 Edit an item.

 Delete an item.

 Upload/remove an attachment.

 Open the audit history using the clock icon.

 See realistic sample data.

Do not add features that are not specified in this prompt. Keep the scope strictly to this stakeholder management application.

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/39053dd8-65c0-4deb-abd5-e723dd287e15).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
