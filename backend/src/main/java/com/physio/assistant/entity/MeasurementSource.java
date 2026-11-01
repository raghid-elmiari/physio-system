package com.physio.assistant.entity;

/** Who or what produced a measured value. Stored with every measurement and performance entry. */
public enum MeasurementSource {
    PATIENT_REPORTED,
    THERAPIST_MEASURED,
    /** Produced by an automated model (e.g. on-device MediaPipe); not clinically validated. */
    COMPUTER_VISION
}
