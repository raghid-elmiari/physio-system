package com.physio.assistant.repository;

import com.physio.assistant.entity.User;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;
import java.util.Optional;

public interface UserRepository extends JpaRepository<User, Long> {
    Optional<User> findByEmail(String email);
    Optional<User> findByEmailIgnoreCase(String email);
    boolean existsByEmail(String email);
    boolean existsByEmailIgnoreCase(String email);
    List<User> findByTherapistIdOrderByLastNameAscFirstNameAsc(Long therapistId);
    List<User> findByRoleOrderByLastNameAscFirstNameAsc(User.Role role);
}
