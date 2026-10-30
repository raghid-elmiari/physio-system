package com.physio.assistant;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.scheduling.annotation.EnableScheduling;

@SpringBootApplication
@EnableScheduling // needed for the device-offline-detection sweep in DeviceService
public class PhysioAssistantApplication {
    public static void main(String[] args) {
        SpringApplication.run(PhysioAssistantApplication.class, args);
    }
}
