{
  "id": "history-taking",
  "title": "Medical history taking",
  "type": "history",
  "discipline": ["medicine", "nursing", "paramedicine", "pharmacy", "allied-health"],
  "summary": "A Calgary–Cambridge aligned structure for a focused history. Initiate, gather (including ICE), build the background history, then explain, plan and close.",
  "disclaimer": "For simulated education and experimental use only. Not for clinical use.",
  "redFlags": [
    "Screen early for red-flag features relevant to the presenting complaint and escalate if present.",
    "Always check allergies before any discussion of treatment."
  ],
  "steps": [
    {
      "id": "initiate",
      "label": "Initiate the session",
      "cue": "Greet the patient, introduce yourself, confirm identity and gain consent.",
      "detail": [
        "Name and role; confirm patient name + a second identifier.",
        "Establish rapport and the reason for today's visit.",
        "Gain consent to take a history."
      ],
      "coverageHints": ["my name", "introduce", "consent", "is it okay", "confirm your name", "date of birth"]
    },
    {
      "id": "pc",
      "label": "Presenting complaint",
      "cue": "Ask an open question and let the patient tell their story.",
      "detail": [
        "Use an open opener: \"What's brought you in today?\"",
        "Listen without interrupting; note the patient's own words."
      ],
      "coverageHints": ["what brings you", "what's brought you", "tell me about", "how can i help"]
    },
    {
      "id": "hpc",
      "label": "History of presenting complaint",
      "cue": "Explore the complaint systematically — e.g. SOCRATES for pain.",
      "detail": [
        "Site, Onset, Character, Radiation, Associations, Timing, Exacerbating/relieving, Severity.",
        "Clarify timeline and progression.",
        "Screen relevant red-flag features."
      ],
      "coverageHints": ["where", "when did it start", "describe the pain", "how severe", "anything make it worse", "radiate", "how long"]
    },
    {
      "id": "ice",
      "label": "Ideas, concerns, expectations",
      "cue": "Explore the patient's ideas, concerns and expectations.",
      "detail": [
        "Ideas: what do they think is going on?",
        "Concerns: what worries them most?",
        "Expectations: what are they hoping for today?"
      ],
      "coverageHints": ["what do you think", "worried", "concern", "hoping", "expecting"]
    },
    {
      "id": "pmh",
      "label": "Past medical history",
      "cue": "Ask about past and ongoing medical and surgical history.",
      "detail": [
        "Chronic conditions, past significant illnesses, hospitalisations and surgery.",
        "Relevant screening or immunisations."
      ],
      "coverageHints": ["medical conditions", "past history", "surgery", "operations", "diagnosed with", "hospital"]
    },
    {
      "id": "dh",
      "label": "Medications",
      "cue": "Take a full medication history, including non-prescription products.",
      "detail": [
        "Prescription, OTC and complementary medicines; doses and adherence.",
        "Recent changes to medicines."
      ],
      "coverageHints": ["medications", "medicines", "tablets", "what do you take", "over the counter", "supplements"]
    },
    {
      "id": "allergies",
      "label": "Allergies",
      "cue": "Confirm allergies and the nature of each reaction.",
      "detail": [
        "Drug, food and environmental allergies.",
        "Describe what happens with each reaction."
      ],
      "coverageHints": ["allergies", "allergic", "reaction", "any allergies"]
    },
    {
      "id": "fh",
      "label": "Family history",
      "cue": "Ask about relevant family history.",
      "detail": [
        "Conditions running in the family, particularly those relevant to the presenting complaint.",
        "Age and cause where significant."
      ],
      "coverageHints": ["family history", "runs in the family", "parents", "siblings"]
    },
    {
      "id": "sh",
      "label": "Social history",
      "cue": "Explore social history — smoking, alcohol, occupation, home and function.",
      "detail": [
        "Smoking, alcohol and other substances.",
        "Occupation, living situation, supports and functional impact."
      ],
      "coverageHints": ["smoke", "alcohol", "drink", "work", "live", "who's at home", "occupation"]
    },
    {
      "id": "ros",
      "label": "Systems review",
      "cue": "Run a focused review of systems relevant to the presentation.",
      "detail": [
        "Screen the systems most relevant to the complaint.",
        "Pick up associated symptoms the patient hasn't volunteered."
      ],
      "coverageHints": ["any other symptoms", "fevers", "weight", "appetite", "bowels", "breathing", "chest"]
    },
    {
      "id": "summarise",
      "label": "Summarise & plan",
      "cue": "Summarise back, agree a plan and safety-net.",
      "detail": [
        "Reflect the history back and check for accuracy.",
        "Explain next steps and agree a plan together.",
        "Safety-net: what to watch for and when to return.",
        "Invite questions and close."
      ],
      "coverageHints": ["so to summarise", "let me check i've got", "the plan", "come back if", "any questions"]
    }
  ]
}
