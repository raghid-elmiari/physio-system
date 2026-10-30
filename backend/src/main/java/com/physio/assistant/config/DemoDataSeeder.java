package com.physio.assistant.config;

import com.physio.assistant.entity.Exercise;
import com.physio.assistant.entity.ExerciseAssignment;
import com.physio.assistant.entity.User;
import com.physio.assistant.repository.ExerciseAssignmentRepository;
import com.physio.assistant.repository.ExerciseRepository;
import com.physio.assistant.repository.UserRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

/**
 * Local-development seed: one therapist, one patient linked to them, and an assignment of
 * the Shoulder Raise exercise. Enabled only with SEED_DEMO_DATA=true, and the password comes
 * from DEMO_USER_PASSWORD (never hardcoded). Existing accounts are never modified.
 */
@Component
@ConditionalOnProperty(name = "app.seed.demo-data", havingValue = "true")
public class DemoDataSeeder implements ApplicationRunner {

    private static final Logger log = LoggerFactory.getLogger(DemoDataSeeder.class);
    static final String THERAPIST_EMAIL = "therapist@demo.local";
    static final String PATIENT_EMAIL = "patient@demo.local";

    private final UserRepository userRepository;
    private final ExerciseRepository exerciseRepository;
    private final ExerciseAssignmentRepository assignmentRepository;
    private final PasswordEncoder passwordEncoder;
    private final String demoPassword;

    public DemoDataSeeder(UserRepository userRepository, ExerciseRepository exerciseRepository,
                          ExerciseAssignmentRepository assignmentRepository, PasswordEncoder passwordEncoder,
                          @Value("${app.seed.demo-password}") String demoPassword) {
        this.userRepository = userRepository;
        this.exerciseRepository = exerciseRepository;
        this.assignmentRepository = assignmentRepository;
        this.passwordEncoder = passwordEncoder;
        this.demoPassword = demoPassword;
    }

    @Override
    @Transactional
    public void run(ApplicationArguments args) {
        if (demoPassword == null || demoPassword.length() < 8) {
            log.warn("SEED_DEMO_DATA=true but DEMO_USER_PASSWORD is missing or shorter than 8 characters; skipping demo seed.");
            return;
        }
        if (userRepository.existsByEmailIgnoreCase(PATIENT_EMAIL)) return;

        User therapist = userRepository.findByEmailIgnoreCase(THERAPIST_EMAIL)
                .orElseGet(() -> userRepository.save(user("Taylor", "Therapist", THERAPIST_EMAIL, User.Role.THERAPIST)));
        User patient = user("Pat", "Patient", PATIENT_EMAIL, User.Role.PATIENT);
        patient.setTherapist(therapist);
        patient.setRehabStatus(User.RehabStatus.IN_TREATMENT);
        userRepository.save(patient);

        Exercise shoulderRaise = exerciseRepository.findFirstByAnalyzerKey("shoulder_abduction_bilateral").orElse(null);
        if (shoulderRaise != null) {
            ExerciseAssignment prescription = new ExerciseAssignment();
            prescription.setPatient(patient);
            prescription.setExercise(shoulderRaise);
            prescription.setAssignedBy(therapist);
            prescription.setTargetReps(8);
            prescription.setSetsPerSession(1);
            prescription.setSessionsPerWeek(5);
            prescription.setRestSeconds(30);
            prescription.setDifficulty(ExerciseAssignment.Difficulty.EASY);
            prescription.setStartDate(java.time.LocalDate.now());
            prescription.setNotes("Move slowly and stop if you feel sharp pain.");
            assignmentRepository.save(prescription);
        }
        log.info("Seeded demo accounts {} and {} (password from DEMO_USER_PASSWORD).", THERAPIST_EMAIL, PATIENT_EMAIL);
    }

    private User user(String firstName, String lastName, String email, User.Role role) {
        User user = new User();
        user.setFirstName(firstName);
        user.setLastName(lastName);
        user.setEmail(email);
        user.setRole(role);
        user.setPasswordHash(passwordEncoder.encode(demoPassword));
        return user;
    }
}
