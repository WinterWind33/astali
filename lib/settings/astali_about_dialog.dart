// Copyright (c) 2023 Andrea Ballestrazzi
import 'package:flutter/material.dart';

/// Shows the about dialog with application information and
/// legal notices.
void showAstaliAboutDialog(BuildContext context) {
  showAboutDialog(
        context: context,
        applicationName: "Astali",
        applicationVersion: "0.0.1",
        applicationLegalese: "MIT License"
  );
}
