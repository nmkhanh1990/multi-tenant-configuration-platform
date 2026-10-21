# Kế hoạch: Admin quản lý cấu hình tenant

## Vấn đề và hướng tiếp cận

Repository hiện chỉ có README, chưa có ứng dụng. Xây dựng monorepo pnpm gồm `apps/api` (Node.js/Express và SQLite), `apps/web` (SvelteKit và Tailwind CSS), và `packages/shared` (kiểu dữ liệu, schema validation và logic dùng chung). Mục tiêu là quản lý cấu hình tenant đầy đủ qua UI, lưu lịch sử có thể rollback, đồng thời dùng chính cấu hình đó để preview và xử lý claim.

## Các đầu việc

1. **Dựng nền monorepo và gói shared**
   - Thiết lập pnpm workspaces, scripts và cấu hình TypeScript cho ba workspace.
   - Định nghĩa mô hình tenant/config/version, loại claim, tài liệu, approval tiers, notification, SLA và custom fields.
   - Tạo schema validation dùng chung giữa UI và API; kiểm tra các ràng buộc trong README.
   - Định nghĩa cấu hình mẫu đầy đủ cho SafeGuard Insurance, HealthFirst và GovHealth.

2. **Xây dựng API, SQLite và xử lý claim**
   - Tạo Express API và lưu tenant cùng các snapshot cấu hình versioned trong SQLite.
   - Cung cấp CRUD, truy vấn lịch sử và rollback; rollback phục hồi nội dung snapshot thành một version mới.
   - Cài đặt `processClaim(tenantId, claimData)` dùng cấu hình hiện hành để trả tài liệu bắt buộc, tuyến phê duyệt, kênh thông báo, hạn SLA và custom fields cần xác thực.
   - Thêm API preview, so sánh hai cấu hình và nạp ba tenant mẫu.

3. **Xây dựng giao diện quản trị SvelteKit**
   - Làm danh sách và biểu mẫu tạo/sửa/xóa tenant, chia theo branding, claim types/documents, approval, notifications, SLA và custom fields.
   - Hiển thị lỗi validation rõ ràng và ngăn lưu cấu hình không hợp lệ.
   - Làm preview claim, so sánh hai tenant có làm nổi bật khác biệt, và màn hình xem/rollback lịch sử.

4. **Tích hợp và xác minh chức năng**
   - Kết nối UI với API và dùng chung schema/types để hạn chế sai khác giữa client và server.
   - Kiểm thử validation, tạo version/rollback, diff, preview và kết quả xử lý claim cho cả ba tenant.
   - Xác minh có thể tạo tenant thứ tư qua UI/API mà không sửa mã; kiểm tra ba tenant cho kết quả khác nhau với cùng một claim.

## Lưu ý và quyết định

- Phạm vi tập trung vào chức năng Admin và runtime; không bao gồm triển khai hosting, xuất bản GitHub hoặc kịch bản demo nộp bài.
- Mỗi lần lưu cấu hình tạo snapshot bất biến. Rollback không sửa/xóa lịch sử mà tạo version mới từ snapshot được chọn.
- SLA được mô tả theo ngày làm việc; tính deadline theo ngày làm việc, bỏ qua thứ Bảy và Chủ nhật, trừ khi yêu cầu được điều chỉnh trong quá trình triển khai.
- README không cung cấp danh sách document cụ thể, tier boundaries/roles đầy đủ, nội dung template hoặc ngày SLA cho từng loại claim ở mọi tenant. Sẽ bổ sung dữ liệu mẫu nhất quán, có ý nghĩa để preview/diff/runtime hoạt động; giữ các giá trị đã nêu làm yêu cầu gốc.
- Làm rõ giới hạn giữa config và dữ liệu claim: claim dùng cho preview là dữ liệu đầu vào, không tạo một claims workflow/persistence subsystem ngoài phạm vi.
