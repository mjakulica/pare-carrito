# Pare Carrito SAS ERP

Static local ERP for testing and deployment to AWS. It uses browser `localStorage`, so no backend, database, API keys, or npm install are required.

## Run Locally

Option 1: open directly:

```text
index.html
```

Option 2: run a tiny local static server from this folder:

```powershell
node .\local-server.js
```

Then open:

```text
http://127.0.0.1:8787
```

## Test Users

- Gerente: username `gerente`, password `gerente123`
- Admin: username `admin`, password `admin123`
- Empleado: username `empleado`, password `empleado123`
- Cliente: username `cliente`, password `cliente123`

## Included Features

- Persistent sidebar and role-aware navigation.
- Username/password login for gerente, admin, employee, and customer roles.
- Back and Home buttons on Clientes, Productos, Precios, Compras, Dividir Compras, Vehiculos, Remitos, Pagos, Saldos, and Proveedores.
- Local seeded data for clients, products, vehicles, and providers.
- Nuevo Pedido with grid/list views, product search with clear button, WhatsApp pasted-order parsing, unmatched-product alias linking, product aliases by client/general product where the client alias takes priority, alias lookup/edit modal, small editable product images, an `Agregar Productos` cart summary with remove buttons, product notes, date restrictions for customer orders after 05:30, list-price defaults, IVA calculation for invoiced clients, and customer/product favorites remembered from previous orders.
- Customer users can create and edit Nuevo Pedido from their own account before the 05:00 deadline. Customer product cards and cart hide unit prices, subtotal, IVA, vehicle, WhatsApp paste, aliases, and order total while still saving the order with the correct internal accounting.
- Pedidos with one-by-one order editing, bulk visible-order status update, Remitos, print-ready remito pages, and order status changes.
- Proveedores CRUD with `Agregar proveedor` button.
- Compras/Gastos with multiple product lines, searchable product comboboxes ordered by typed match, provider dropdowns, seller registration, provider/seller favorite product grid, employee assigned-product grid, admin/manager assignee filters, `Preparado` status, `Actualizar precio mercado`, `Pago a Proveedor` flow, expense assignment to employee cash, Pagado/Cuenta Corriente status for admin and employee provider purchases, provider payment by full/partial amount, product cost updates, cost-relation divisor updates from calculation units, and provider account tracking.
- Provider payment tab for full or partial payments against Cuenta Corriente balances.
- Employee expense logging for product expenses and other operational expenses.
- Dividir Compras groups today's products from the assignment configured on each Product, with views by product/client and by client/assignee, direct print/PDF for one assignee or all assignees, WhatsApp clipboard export, and order-item notes.
- Vehiculos with per-vehicle order cards, add/edit/delete vehicle controls, consolidated product totals, grouped print pages, and a flat print page without grouping by vehicle.
- Remitos can print/export all remitos for today's date, warn on today's notes, warn when products have no purchase/prepared record, and are available to employee users.
- Pagos for employees/admins/managers. Payments can relate multiple non-duplicated orders filtered by selected client/linked accounts, hide orders already paid in full, show selected-order total and partial-payment difference, choose which employee/admin/manager received the collection, subtract the correct client's Saldos balance, and admin/manager can also upload transfer proof files.
- Saldos with client balances, accumulated IVA for invoiced clients, date-ranged movement history, printable/exportable movement list per selected client, automatic order/payment reconciliation, and repaired legacy order/payment linkage. Customers see their own linked accounts.
- Caja/Rendicion with order accountability records and real payment income without double-counting.
- Admin dashboard with employee cash and bank cash summaries.
- Empleados tab with employee users, employee cash, collection history, attendance sheet, weekly pay calculation, and salary payment records.
- Employee Horarios tab for end-of-day presence and work-hour registration, default start at 05:45, conventional-shift and overtime calculations.
- Customer portal with account selector for linked accounts, today/last order amount, linked-account total view, date-range reports, linked customer accounts, order drill-down, expandable product date history, product totals, pie chart by spend, and bar chart by quantities.
- Gerente-only Usuarios tab to create, edit, deactivate, and delete users.
- Configuracion tab for all users to change password, email, and contact details.
- Client invoice fields: email, CUIT, legal name, invoice type/frequency, price tier `Con Factura`, client price adjustment percentage, and IVA-aware remitos.
- Product IVA selector with no gravado, exento, 0%, 2.5%, 5%, 10.5%, 21%, and 27%.
- Prices include market price, editable margin, and manager/admin cost relations so a source product can update linked products through divisor/multiplier calculations.
- Productos include assignment to a provider/employee and update linked-cost products when edited.
- Productos include an `Unidades` checkbox. Employee users get an `Unidades` tab to adjust same-day unit/weight quantities, remove products without purchase from today's orders, and export today's remitos.
- Proveedores include a selected-provider account panel with date-ranged movements, balance, and printable/exportable provider statement.
- Customer account linking requires the linked customer's username/password; gerente/admin can link accounts directly from user management.
- Backup export/import as JSON.
- Numeric display uses one decimal across balances, totals, quantities, IVA, and reports.

## Accounting Rule Used

Orders create:

- a Saldos debt entry
- a Caja/Rendicion accountability entry with expected amount only

Payments create:

- a Saldos payment entry
- a Caja/Rendicion ingreso

This prevents the same sale from being counted once when the order is created and again when payment is received.

Provider purchases create:

- a Caja/Rendicion egreso when marked `Pagado`
- a provider Cuenta Corriente debt when marked `Cuenta Corriente`
- a Caja/Rendicion egreso only when that provider debt is later paid, either partially or in full

## AWS Deployment

Recommended production shape:

- S3 private bucket for the static files.
- CloudFront distribution in front of S3.
- CloudFront Origin Access Control (OAC), keeping S3 Block Public Access enabled.

Official AWS references:

- https://docs.aws.amazon.com/AmazonS3/latest/dev/WebsiteHosting.html
- https://docs.aws.amazon.com/AmazonS3/latest/userguide/access-control-best-practices.html
- https://docs.aws.amazon.com/cli/latest/reference/s3/sync.html

### 1. Create Infrastructure With CloudFormation

From this app folder:

```powershell
aws cloudformation deploy `
  --stack-name pare-carrito-sas-erp `
  --template-file .\aws\static-site-cloudfront-oac.yaml `
  --parameter-overrides SiteBucketName=pare-carrito-sas-erp-yourname `
  --capabilities CAPABILITY_NAMED_IAM
```

CloudFormation outputs:

- `BucketName`
- `CloudFrontDistributionId`
- `CloudFrontDomainName`

### 2. Upload Files

Replace the bucket name with the CloudFormation output.

```powershell
aws s3 sync . s3://pare-carrito-sas-erp-yourname `
  --exclude "aws/*" `
  --exclude "README.md" `
  --exclude "local-server.js" `
  --cache-control "no-cache"
```

### 3. Invalidate CloudFront

Replace the distribution id with the CloudFormation output.

```powershell
aws cloudfront create-invalidation `
  --distribution-id YOUR_DISTRIBUTION_ID `
  --paths "/*"
```

### 4. Open The Site

Use:

```text
https://YOUR_CLOUDFRONT_DOMAIN.cloudfront.net
```

## Data Safety

Because this version is localStorage-based, data lives in each user's browser. Before clearing browser data or switching computers, use `Backup > Descargar backup`, then restore it with `Backup > Importar`.

New client password email is prepared with a `mailto:` draft in this static build. A real automatic send requires the future backend/email service.

For multi-user production with shared data, the next upgrade should add a backend database and authentication service.
