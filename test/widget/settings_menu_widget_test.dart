// Copyright (C) 2022 Andrea Ballestrazzi

import 'package:flutter_test/flutter_test.dart';
import 'package:flutter/material.dart';

// Production classes
import 'package:astali/astali_app.dart';
import 'package:astali/astali_main_injector.dart';

void main() {
  testWidgets("The default settings menu should have an 'About' section",
      (tester) async {
    await tester.pumpWidget(const AstaliApp(AstaliMainInjector()));

    // Now we need to generate the settings menu. Here we tap the settings button.
    await tester.tap(find.byIcon(Icons.settings));
    await tester.pump();

    final aboutItemFinder = find.text("About");

    // We should have only one widget with the title "About".
    expect(aboutItemFinder, findsOneWidget);
  });

  testWidgets(
      "When a click is done on the 'About' section, it should be displayed the about dialog",
      (tester) async {
    await tester.pumpWidget(const AstaliApp(AstaliMainInjector()));

    await tester.tap(find.byIcon(Icons.settings));
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(PopupMenuItem<String>, "About"));
    await tester.pumpAndSettle();

    final aboutDialogFinder = find.byType(AboutDialog);

    expect(aboutDialogFinder, findsOneWidget);
  });
}
