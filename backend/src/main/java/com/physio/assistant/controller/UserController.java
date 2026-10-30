package com.physio.assistant.controller;

import com.physio.assistant.dto.ExerciseDtos.AssignmentResponse;
import com.physio.assistant.dto.ProgressDtos.ProgressResponse;
import com.physio.assistant.dto.UserDtos.*;
import com.physio.assistant.security.CurrentUser;
import com.physio.assistant.service.ExerciseService;
import com.physio.assistant.service.ProgressService;
import com.physio.assistant.service.UserService;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;

import java.util.List;

/** Endpoints about the signed-in user: profile, their assigned program, their progress. */
@RestController
@RequestMapping("/api")
public class UserController {

    private final UserService userService;
    private final ExerciseService exerciseService;
    private final ProgressService progressService;

    public UserController(UserService userService, ExerciseService exerciseService, ProgressService progressService) {
        this.userService = userService;
        this.exerciseService = exerciseService;
        this.progressService = progressService;
    }

    @GetMapping("/users/me")
    public ProfileResponse me(Authentication auth) {
        return userService.getProfile(CurrentUser.of(auth).userId());
    }

    @PutMapping("/users/me")
    public ProfileResponse update(Authentication auth, @Valid @RequestBody UpdateProfileRequest request) {
        return userService.updateProfile(CurrentUser.of(auth).userId(), request);
    }

    @PutMapping("/users/me/password")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void changePassword(Authentication auth, @Valid @RequestBody ChangePasswordRequest request) {
        userService.changePassword(CurrentUser.of(auth).userId(), request);
    }

    @GetMapping("/assignments")
    public List<AssignmentResponse> myAssignments(Authentication auth) {
        return exerciseService.assignmentsFor(CurrentUser.of(auth).userId());
    }

    @GetMapping("/progress")
    public ProgressResponse myProgress(Authentication auth, @RequestParam(defaultValue = "90") int days) {
        return progressService.forUser(CurrentUser.of(auth).userId(), days);
    }
}
