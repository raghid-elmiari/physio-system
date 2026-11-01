package com.physio.assistant.controller;

import com.physio.assistant.dto.AdminDtos.*;
import com.physio.assistant.security.CurrentUser;
import com.physio.assistant.service.AdminService;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;

import java.util.List;

/** Administrator API. /api/admin/** requires the ADMIN role (SecurityConfig). Nothing here deletes records. */
@RestController
@RequestMapping("/api/admin")
public class AdminController {

    private final AdminService adminService;

    public AdminController(AdminService adminService) {
        this.adminService = adminService;
    }

    @GetMapping("/stats")
    public AdminStats stats() {
        return adminService.stats();
    }

    @GetMapping("/users")
    public List<AdminUserResponse> users(@RequestParam(required = false) String role,
                                         @RequestParam(required = false) String status,
                                         @RequestParam(required = false) String search) {
        return adminService.listUsers(role, status, search);
    }

    @GetMapping("/users/{id}")
    public AdminUserResponse user(@PathVariable Long id) {
        return adminService.getUser(id);
    }

    @PostMapping("/users")
    @ResponseStatus(HttpStatus.CREATED)
    public AdminUserResponse createUser(Authentication auth, @Valid @RequestBody CreateUserRequest request) {
        return adminService.createUser(CurrentUser.of(auth), request);
    }

    @PutMapping("/users/{id}/role")
    public AdminUserResponse changeRole(Authentication auth, @PathVariable Long id, @Valid @RequestBody ChangeRoleRequest request) {
        return adminService.changeRole(CurrentUser.of(auth), id, request);
    }

    @PutMapping("/users/{id}/status")
    public AdminUserResponse changeStatus(Authentication auth, @PathVariable Long id, @Valid @RequestBody ChangeStatusRequest request) {
        return adminService.changeStatus(CurrentUser.of(auth), id, request);
    }

    @PutMapping("/patients/{id}/therapist")
    public AdminUserResponse assignTherapist(Authentication auth, @PathVariable Long id, @Valid @RequestBody AssignTherapistRequest request) {
        return adminService.assignTherapist(CurrentUser.of(auth), id, request);
    }

    @GetMapping("/therapists/workload")
    public List<TherapistWorkload> workloads() {
        return adminService.therapistWorkloads();
    }

    @GetMapping("/audit-logs")
    public AuditPage auditLog(@RequestParam(required = false) String entityType,
                              @RequestParam(required = false) Long actorId,
                              @RequestParam(defaultValue = "0") int page,
                              @RequestParam(defaultValue = "50") int size) {
        return adminService.auditLog(entityType, actorId, page, size);
    }

    @GetMapping("/permissions")
    public List<RolePermissions> permissions() {
        return adminService.permissions();
    }
}
