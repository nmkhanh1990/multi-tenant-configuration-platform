# Kế hoạch dự án — Multi-Tenant Configuration Platform

## Mục tiêu và bối cảnh

Nền tảng bảo hiểm phục vụ nhiều công ty bảo hiểm (tenant). Mỗi tenant có
branding, loại claim, tài liệu, quy tắc phê duyệt, thông báo, SLA và trường dữ
liệu riêng. Đội vận hành cần quản lý những khác biệt này qua giao diện Admin,
không cần thay đổi mã nguồn; runtime phải xử lý claim theo cấu hình hiện hành.

Repository được tổ chức dạng pnpm monorepo:

- `apps/api`: Node.js, Express và SQLite.
- `apps/web`: SvelteKit và Tailwind CSS.
- `packages/shared`: models, Zod schemas, utilities và tenant fixtures dùng chung.

## Kế hoạch ban đầu và trạng thái

### 1. Dựng nền monorepo và gói shared — Hoàn tất

- [x] Thiết lập pnpm workspace, scripts và cấu hình TypeScript cho API, web và shared.
- [x] Định nghĩa tenant, configuration, version, claim type, documents, approval
  tiers, notifications, SLA và custom fields.
- [x] Chia sẻ schema validation giữa client và API.
- [x] Tạo ba tenant mẫu SafeGuard Insurance, HealthFirst và GovHealth.

### 2. Xây dựng API, SQLite và xử lý claim — Hoàn tất

- [x] Xây dựng Express API, lưu tenant và snapshot cấu hình versioned trong SQLite.
- [x] Hỗ trợ CRUD, truy vấn lịch sử, so sánh cấu hình và rollback. Mỗi lần lưu/rollback
  tạo version mới; snapshot cũ không bị ghi đè.
- [x] Xây dựng xử lý/preview claim theo cấu hình: tài liệu bắt buộc, phê duyệt,
  kênh thông báo, deadline SLA theo ngày làm việc và validation custom fields.
- [x] Seed ba tenant mẫu khi database rỗng.

### 3. Xây dựng giao diện Admin SvelteKit — Hoàn tất

- [x] Tạo danh sách tenant, chi tiết cấu hình, thêm/sửa/xóa tenant.
- [x] Chia biểu mẫu thành branding, claim types/documents, approval, notifications,
  service levels và custom fields.
- [x] Bổ sung validation, thông báo lỗi theo field và wizard tạo tenant tuần tự.
- [x] Tạo claim preview, so sánh cấu hình hai tenant và version history/rollback.
- [x] Tái cấu trúc chi tiết tenant thành các section, có URL riêng cho tenant và
  luồng tạo tenant tại `/tenants/create`.

### 4. Tích hợp và xác minh — Hoàn tất

- [x] Tích hợp web, API và shared models/schema.
- [x] Kiểm thử validation, history/rollback, diff, preview và xử lý claim.
- [x] Xác minh các tenant mẫu có hành vi khác nhau theo cấu hình và có thể tạo
  tenant mới qua UI mà không sửa mã.
- [x] Kiểm tra Svelte: 0 lỗi, 0 cảnh báo; API: 11 test đạt.

## Quyết định thiết kế

- Mỗi lần lưu cấu hình tạo snapshot bất biến. Rollback tạo một version mới từ
  snapshot đích thay vì xóa hoặc sửa lịch sử.
- Chỉ các claim có amount **nhỏ hơn** auto-approval threshold mới auto-approve.
  Claim có amount bằng threshold đi vào approval tier.
- SLA tính theo ngày làm việc, bỏ qua thứ Bảy và Chủ nhật; không có lịch nghỉ lễ.
- Preview dùng dữ liệu claim mẫu, không lưu hoặc gửi claim thật. Kết quả notifications
  là các channel cần kích hoạt, không phải dịch vụ gửi email/SMS/webhook.
- README ban đầu không cung cấp đầy đủ document/tier/template/SLA cho mọi tenant.
  Fixtures được hoàn thiện nhất quán để demo preview, diff và runtime.

## Kế hoạch bổ sung — Deploy demo miễn phí

Yêu cầu Submission là push source lên GitHub, deploy giao diện Admin miễn phí và
cung cấp demo ngắn. Giữ SQLite cho demo; dữ liệu sửa đổi có thể mất khi Render
Free service restart, redeploy hoặc spin down. Demo không dành cho production
hoặc dữ liệu cá nhân.

### 5. Xác minh hosting và chuẩn bị cấu hình — Hoàn tất

- [x] Xác minh Cloudflare Pages cho SvelteKit và Render Free cho Express API.
- [x] Cấu hình Cloudflare adapter/output, build shared package và các deep link.
- [x] Thêm Render Blueprint với production build/start, `PORT`, SQLite tạm,
  `CORS_ORIGINS` và `/health`.
- [x] Tài liệu hóa các bước deploy, giới hạn persistence và kịch bản demo.

### 6. Xuất bản và xác minh demo public — Hoàn tất

- [x] Push cấu hình và ứng dụng lên GitHub (`639ea80`).
- [x] Tạo Render Blueprint, deploy API và cấu hình CORS cho Pages origin.
- [x] Build UI với `VITE_API_BASE_URL` của API public và deploy Pages bằng Wrangler.
- [x] Kiểm tra API health, sample tenants, CORS, Pages root và deep links.
- [x] Smoke-test compare tenants và claim preview trên demo live.
- [x] Ghi URL public vào README và push thay đổi (`69d8b27`).

### URL demo

- Admin UI: <https://multi-tenant-configuration-platform.pages.dev/>
- API health: <https://multi-tenant-configuration-api.onrender.com/health>
- Render Free dùng filesystem ephemeral; tenant/config/version do người dùng tạo
  có thể mất sau lần restart/spin down. Khi database rỗng, API seed lại ba tenant mẫu.

## Phạm vi và giới hạn

- Không dùng demo này cho production hoặc dữ liệu cá nhân.
- Render Free có thể spin down khi không có traffic; request đầu sau đó có thể mất
  khoảng một phút để service thức dậy.
- CORS chỉ cho phép origin Pages được cấu hình.
- Wrangler CLI đã được đăng xuất sau khi deploy; không lưu access token vào repo.
- Source đã deploy ở các commit trên nhánh `main`. Working tree có một thay đổi
  whitespace cục bộ chưa commit trong `apps/api/src/claim-processing.ts`; thay đổi
  này không thuộc triển khai và được giữ nguyên.
